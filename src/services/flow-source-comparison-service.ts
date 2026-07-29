/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowComparisonFailed, flowVersionNotFound } from '../errors/flow-errors.js';
import type {
  FlowCompareRequest,
  FlowCompareResult,
  FlowCompareSources,
  FlowComparisonChange,
  FlowComparisonVersionSelector,
  FlowMetadataGateway,
  JsonObject,
} from '../types/flow-analysis.js';
import type { FlowDefinitionGateway, FlowVersion } from '../types/flow.js';
import { canonicalFlowComparisonPair } from '../utils/flow-comparison-canonical.js';
import { compareFlowMetadata } from '../utils/flow-metadata-diff.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

type ComparisonGateway = FlowDefinitionGateway & FlowMetadataGateway;

export interface SourceComparisonGateways {
  from: ComparisonGateway | undefined;
  to: ComparisonGateway | undefined;
}

interface ComparisonOperand {
  apiName: string;
  namespace: string | null;
  definitionId: string | null;
  version: FlowVersion['versionNumber'] | null;
  sourceFile: string | null;
  org: string | null;
  metadata: JsonObject;
}

interface OrgOperandRequest {
  gateway: ComparisonGateway;
  request: FlowCompareRequest;
  selector: FlowComparisonVersionSelector;
  org: string;
  progress: FlowProgressReporter;
}

interface SourceComparisonContext {
  gateways: SourceComparisonGateways;
  request: FlowCompareRequest;
  sources: FlowCompareSources;
  progress: FlowProgressReporter;
}

function operandName(operand: ComparisonOperand): string {
  return qualifiedFlowName(operand.apiName, operand.namespace);
}

function assertMatchingIdentity(request: FlowCompareRequest, from: ComparisonOperand, to: ComparisonOperand): void {
  const expected = qualifiedFlowName(request.apiName, request.namespace ?? null);
  const mismatched = [from, to].find((operand) => operandName(operand) !== expected);
  if (mismatched !== undefined) {
    throw flowComparisonFailed(
      `The comparison expected Flow "${expected}" but resolved "${operandName(
        mismatched
      )}". The requested identity must match every local source operand.`
    );
  }
  if (operandName(from) !== operandName(to)) {
    throw flowComparisonFailed(
      `The comparison resolved different Flows: "${operandName(from)}" and "${operandName(
        to
      )}". Compare source files and org versions of the same qualified Flow.`
    );
  }
}

function sourceOperand(source: NonNullable<FlowCompareSources['from']>): ComparisonOperand {
  return {
    apiName: source.apiName,
    namespace: source.namespace,
    definitionId: null,
    version: null,
    sourceFile: source.sourceFile,
    org: null,
    metadata: source.metadata,
  };
}

function selectedVersion(
  versions: ReadonlyArray<FlowVersion>,
  definition: Awaited<ReturnType<ComparisonGateway['findDefinitions']>>[number],
  selector: FlowComparisonVersionSelector
): FlowVersion {
  const versionId =
    selector === 'active' ? definition.activeVersionId : selector === 'latest' ? definition.latestVersionId : null;
  const version =
    typeof selector === 'number'
      ? versions.find((candidate) => candidate.versionNumber === selector)
      : versions.find((candidate) => candidate.id === versionId);
  if (version === undefined) {
    if (typeof selector === 'number') {
      throw flowVersionNotFound(definition.apiName, selector);
    }
    throw flowComparisonFailed(`Flow "${definition.apiName}" does not have an ${selector} version.`);
  }
  return version;
}

async function orgOperand(context: OrgOperandRequest): Promise<ComparisonOperand> {
  const { gateway, request, selector, org, progress } = context;
  progress('resolving-flow', `${request.apiName} (${org})`);
  const lookup =
    request.namespace === undefined
      ? { apiName: request.apiName }
      : { apiName: request.apiName, namespace: request.namespace };
  const definition = selectFlowDefinition(request.apiName, await gateway.findDefinitions(lookup));
  const name = qualifiedFlowName(definition.apiName, definition.namespace);
  progress('loading-versions', `${name} (${String(selector)}, ${org})`);
  const version = selectedVersion(await gateway.findVersions(definition.id), definition, selector);
  progress('loading-metadata', `${name} v${version.versionNumber} (${org})`);
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    version: version.versionNumber,
    sourceFile: null,
    org,
    metadata: await gateway.getVersionMetadata(version.id),
  };
}

function requiredGateway(gateway: ComparisonGateway | undefined, side: 'source' | 'target'): ComparisonGateway {
  if (gateway === undefined) {
    throw flowComparisonFailed(`The ${side} comparison side requires an authenticated Salesforce org.`);
  }
  return gateway;
}

function ignoredPath(path: string, ignored: ReadonlyArray<string>): boolean {
  return ignored.some(
    (candidate) => path === candidate || path.startsWith(`${candidate}.`) || path.startsWith(`${candidate}[`)
  );
}

function changeCount(changes: ReadonlyArray<FlowComparisonChange>, kind: FlowComparisonChange['kind']): number {
  return changes.filter((change) => change.kind === kind).length;
}

function createResult(
  request: FlowCompareRequest,
  operands: { from: ComparisonOperand; to: ComparisonOperand },
  changes: FlowComparisonChange[]
): FlowCompareResult {
  const { from, to } = operands;
  return {
    apiName: from.apiName,
    namespace: from.namespace,
    definitionId: from.definitionId ?? to.definitionId,
    fromDefinitionId: from.definitionId,
    toDefinitionId: to.definitionId,
    requestedFrom: from.sourceFile === null ? request.from : null,
    requestedTo: to.sourceFile === null ? request.to : null,
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
    ignorePaths: request.ignorePaths,
    fromVersion: from.version,
    toVersion: to.version,
    fromSourceFile: from.sourceFile,
    toSourceFile: to.sourceFile,
    changes,
    added: changeCount(changes, 'added'),
    removed: changeCount(changes, 'removed'),
    changed: changeCount(changes, 'changed'),
    different: changes.length > 0,
    targetOrg: from.org === to.org ? from.org : null,
    fromOrg: from.org,
    toOrg: to.org,
    crossOrg: from.org !== null && to.org !== null && from.org !== to.org,
  };
}

export async function compareFlowSources(context: SourceComparisonContext): Promise<FlowCompareResult> {
  const { gateways, request, sources, progress } = context;
  const from =
    sources.from === undefined
      ? await orgOperand({
          gateway: requiredGateway(gateways.from, 'source'),
          request,
          selector: request.from,
          org: request.fromOrg,
          progress,
        })
      : sourceOperand(sources.from);
  const to =
    sources.to === undefined
      ? await orgOperand({
          gateway: requiredGateway(gateways.to, 'target'),
          request,
          selector: request.to,
          org: request.toOrg,
          progress,
        })
      : sourceOperand(sources.to);
  assertMatchingIdentity(request, from, to);
  progress('comparing-metadata', `${operandName(from)} → ${operandName(to)}`);
  const metadata = await canonicalFlowComparisonPair(from.metadata, to.metadata);
  const changes = compareFlowMetadata(metadata.from, metadata.to, {
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
  }).filter((change) => !ignoredPath(change.path, request.ignorePaths));
  return createResult(request, { from, to }, changes);
}
