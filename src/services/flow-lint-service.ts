/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDefinitionAmbiguous, flowLintFailed } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema } from '../schemas/flow.js';
import type { FlowComparisonVersionSelector, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import type { FlowLintFinding, FlowLintRequest, FlowLintResult } from '../types/flow-inspection.js';
import { analyseFlowLintMetadata } from '../utils/flow-lint-analysis.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { selectFlowDefinition } from '../utils/flow-state.js';

function lookup(request: Pick<FlowLintRequest, 'apiName' | 'namespace'>): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function subflowLookup(flowName: string): FlowDefinitionLookup | null {
  const separator = flowName.indexOf('__');
  const apiName = separator < 0 ? flowName : flowName.slice(separator + 2);
  const namespace = separator < 0 ? undefined : flowName.slice(0, separator);
  if (
    !flowApiNameSchema.safeParse(apiName).success ||
    (namespace !== undefined && !namespaceSchema.safeParse(namespace).success)
  ) {
    return null;
  }
  return namespace === undefined ? { apiName } : { apiName, namespace };
}

function selectVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  selector: FlowComparisonVersionSelector
): FlowVersion {
  const id =
    selector === 'active'
      ? definition.activeVersionId
      : selector === 'latest'
      ? definition.latestVersionId
      : versions.find((version) => version.versionNumber === selector)?.id;
  const selected = versions.find((version) => version.id === id);
  if (selected === undefined) {
    throw flowLintFailed(`Flow "${definition.apiName}" does not have the requested ${String(selector)} version.`);
  }
  return selected;
}

function subflowFinding(rule: 'inactive-subflow' | 'missing-subflow', flowName: string): FlowLintFinding {
  const missing = rule === 'missing-subflow';
  return {
    rule,
    severity: missing ? 'error' : 'warning',
    message: missing
      ? `Subflow "${flowName}" does not exist or its name is invalid.`
      : `Subflow "${flowName}" does not have an active version.`,
    element: flowName,
    path: null,
  };
}

async function inspectSubflow(gateway: FlowDefinitionGateway, flowName: string): Promise<FlowLintFinding | undefined> {
  const target = subflowLookup(flowName);
  if (target === null) {
    return subflowFinding('missing-subflow', flowName);
  }
  const definitions = await gateway.findDefinitions(target);
  if (definitions.length === 0) {
    return subflowFinding('missing-subflow', flowName);
  }
  if (definitions.length > 1) {
    throw flowDefinitionAmbiguous(flowName);
  }
  return definitions[0]?.activeVersionId === null ? subflowFinding('inactive-subflow', flowName) : undefined;
}

async function inspectSubflows(
  gateway: FlowDefinitionGateway,
  flowNames: ReadonlyArray<string>,
  progress: FlowProgressReporter
): Promise<FlowLintFinding[]> {
  const findings = await Promise.all(
    [...new Set(flowNames)].sort().map(async (flowName) => {
      progress('resolving-flow', `${flowName} (referenced subflow)`);
      return inspectSubflow(gateway, flowName);
    })
  );
  return findings.filter((item): item is FlowLintFinding => item !== undefined);
}

interface LintResultContext {
  request: FlowLintRequest;
  definition: FlowDefinition;
  version: FlowVersion;
  findings: FlowLintFinding[];
}

function createResult(context: LintResultContext): FlowLintResult {
  const { request, definition, version, findings } = context;
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    requestedVersion: request.version,
    resolvedVersion: version.versionNumber,
    status: version.status,
    findings,
    errors: findings.filter((item) => item.severity === 'error').length,
    warnings: findings.filter((item) => item.severity === 'warning').length,
    targetOrg: request.targetOrg,
  };
}

async function runLint(
  gateways: { definitions: FlowDefinitionGateway; metadata: FlowMetadataGateway },
  request: FlowLintRequest,
  progress: FlowProgressReporter
): Promise<FlowLintResult> {
  progress('resolving-flow', request.apiName);
  const definition = selectFlowDefinition(request.apiName, await gateways.definitions.findDefinitions(lookup(request)));
  progress('loading-versions', `${request.apiName} (${String(request.version)})`);
  const version = selectVersion(definition, await gateways.definitions.findVersions(definition.id), request.version);
  progress('loading-metadata', `${request.apiName} v${version.versionNumber}`);
  const metadata = await gateways.metadata.getVersionMetadata(version.id);
  const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
  progress('analysing-results', `${request.apiName} v${version.versionNumber}`);
  const findings = [
    ...analyseFlowLintMetadata(metadata, description),
    ...(await inspectSubflows(
      gateways.definitions,
      description.subflows.map((subflow) => subflow.flowName),
      progress
    )),
  ];
  return createResult({ request, definition, version, findings });
}

export class FlowLintService {
  public constructor(
    private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway,
    private readonly metadataGateway: FlowMetadataGateway = gateway
  ) {}

  public async lint(
    request: FlowLintRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowLintResult> {
    try {
      return await runLint({ definitions: this.gateway, metadata: this.metadataGateway }, request, progress);
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow')) {
        throw error;
      }
      throw flowLintFailed(`Failed to lint Flow "${request.apiName}".`, error);
    }
  }
}
