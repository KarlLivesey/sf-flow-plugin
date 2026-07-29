/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowComparisonFailed, flowVersionNotFound } from '../errors/flow-errors.js';
import { flowComparisonScopeSchema } from '../schemas/flow.js';
import type {
  FlowCompareRequest,
  FlowCompareResult,
  FlowCompareSources,
  FlowComparisonChange,
  FlowComparisonVersionSelector,
  FlowMetadataGateway,
  JsonObject,
} from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import { compareFlowMetadata } from '../utils/flow-metadata-diff.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';
import { compareFlowSources } from './flow-source-comparison-service.js';

interface VersionContext {
  definition: FlowDefinition;
  versions: ReadonlyArray<FlowVersion>;
}

interface ResolvedComparison {
  fromDefinition: FlowDefinition;
  toDefinition: FlowDefinition;
  fromVersion: FlowVersion;
  toVersion: FlowVersion;
  changes: FlowComparisonChange[];
}

interface RequiredComparisonGateways {
  from: FlowDefinitionGateway & FlowMetadataGateway;
  to: FlowDefinitionGateway & FlowMetadataGateway;
}

interface ResolvedSides {
  from: VersionContext;
  to: VersionContext;
  fromVersion: FlowVersion;
  toVersion: FlowVersion;
  detail: string;
}

interface VersionContextRequest {
  gateway: FlowDefinitionGateway;
  request: FlowCompareRequest;
  selector: FlowComparisonVersionSelector;
  org: string;
  progress: FlowProgressReporter;
}

function createLookup(request: FlowCompareRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function versionById(context: VersionContext, selector: 'active' | 'latest', versionId: string | null): FlowVersion {
  if (versionId === null) {
    throw flowComparisonFailed(`Flow "${context.definition.apiName}" does not have an ${selector} version.`);
  }
  const version = context.versions.find((item) => item.id === versionId);
  if (version === undefined) {
    throw flowComparisonFailed(
      `Salesforce returned an unknown ${selector} version for Flow "${context.definition.apiName}".`
    );
  }
  return version;
}

function selectVersion(context: VersionContext, selector: FlowComparisonVersionSelector): FlowVersion {
  if (selector === 'active') {
    return versionById(context, selector, context.definition.activeVersionId);
  }
  if (selector === 'latest') {
    return versionById(context, selector, context.definition.latestVersionId);
  }
  const version = context.versions.find((item) => item.versionNumber === selector);
  if (version === undefined) {
    throw flowVersionNotFound(context.definition.apiName, selector);
  }
  return version;
}

function versionSelectorLabel(selector: FlowComparisonVersionSelector): string {
  return typeof selector === 'number' ? `v${selector}` : selector;
}

function assertMatchingFlowIdentity(contexts: { from: VersionContext; to: VersionContext }): void {
  const fromName = qualifiedFlowName(contexts.from.definition.apiName, contexts.from.definition.namespace);
  const toName = qualifiedFlowName(contexts.to.definition.apiName, contexts.to.definition.namespace);
  if (fromName !== toName) {
    throw flowComparisonFailed(
      `The comparison resolved different Flows: "${fromName}" in the source org and "${toName}" in the target org. Specify --namespace to select the same qualified Flow in both orgs.`
    );
  }
}

function changeCount(changes: ReadonlyArray<FlowComparisonChange>, kind: FlowComparisonChange['kind']): number {
  return changes.filter((change) => change.kind === kind).length;
}

function createResult(request: FlowCompareRequest, comparison: ResolvedComparison): FlowCompareResult {
  const { fromDefinition, toDefinition, fromVersion, toVersion, changes } = comparison;
  return {
    apiName: fromDefinition.apiName,
    namespace: fromDefinition.namespace,
    definitionId: fromDefinition.id,
    fromDefinitionId: fromDefinition.id,
    toDefinitionId: toDefinition.id,
    requestedFrom: request.from,
    requestedTo: request.to,
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
    ignorePaths: request.ignorePaths,
    fromVersion: fromVersion.versionNumber,
    toVersion: toVersion.versionNumber,
    fromSourceFile: null,
    toSourceFile: null,
    changes,
    added: changeCount(changes, 'added'),
    removed: changeCount(changes, 'removed'),
    changed: changeCount(changes, 'changed'),
    different: changes.length > 0,
    targetOrg: request.targetOrg,
    fromOrg: request.fromOrg,
    toOrg: request.toOrg,
    crossOrg: request.fromOrg !== request.toOrg,
  };
}

function requiredGateway(
  gateway: (FlowDefinitionGateway & FlowMetadataGateway) | undefined,
  side: 'source' | 'target'
): FlowDefinitionGateway & FlowMetadataGateway {
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

function shouldRethrow(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous', 'FlowVersionNotFound', 'FlowComparisonFailed'].includes(
      error.name
    )
  );
}

async function resolveComparison(
  gateways: RequiredComparisonGateways,
  request: FlowCompareRequest,
  progress: FlowProgressReporter
): Promise<ResolvedComparison> {
  const sides = await resolveSides(gateways, request, progress);
  const { fromMetadata, toMetadata } = await loadMetadata(gateways, sides, progress);
  progress('comparing-metadata', sides.detail);
  const changes = compareFlowMetadata(fromMetadata, toMetadata, {
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
  }).filter((change) => !ignoredPath(change.path, request.ignorePaths));
  return {
    fromDefinition: sides.from.definition,
    toDefinition: sides.to.definition,
    fromVersion: sides.fromVersion,
    toVersion: sides.toVersion,
    changes,
  };
}

async function resolveVersionContext(context: VersionContextRequest): Promise<VersionContext> {
  const { gateway, request, selector, org, progress } = context;
  progress('resolving-flow', `${request.apiName} (${org})`);
  const definition = selectFlowDefinition(request.apiName, await gateway.findDefinitions(createLookup(request)));
  progress(
    'loading-versions',
    `${qualifiedFlowName(definition.apiName, definition.namespace)} (${versionSelectorLabel(selector)}, ${org})`
  );
  return { definition, versions: await gateway.findVersions(definition.id) };
}

async function resolveContexts(
  gateways: RequiredComparisonGateways,
  request: FlowCompareRequest,
  progress: FlowProgressReporter
): Promise<{ from: VersionContext; to: VersionContext }> {
  const from = await resolveVersionContext({
    gateway: gateways.from,
    request,
    selector: request.from,
    org: request.fromOrg,
    progress,
  });
  if (gateways.from === gateways.to && request.fromOrg === request.toOrg) {
    return { from, to: from };
  }
  const to = await resolveVersionContext({
    gateway: gateways.to,
    request,
    selector: request.to,
    org: request.toOrg,
    progress,
  });
  return { from, to };
}

async function resolveSides(
  gateways: RequiredComparisonGateways,
  request: FlowCompareRequest,
  progress: FlowProgressReporter
): Promise<ResolvedSides> {
  const contexts = await resolveContexts(gateways, request, progress);
  assertMatchingFlowIdentity(contexts);
  const fromVersion = selectVersion(contexts.from, request.from);
  const toVersion = selectVersion(contexts.to, request.to);
  const fromName = qualifiedFlowName(contexts.from.definition.apiName, contexts.from.definition.namespace);
  const toName = qualifiedFlowName(contexts.to.definition.apiName, contexts.to.definition.namespace);
  const detail = `${fromName} v${fromVersion.versionNumber} (${request.fromOrg}) → ${toName} v${toVersion.versionNumber} (${request.toOrg})`;
  return { ...contexts, fromVersion, toVersion, detail };
}

async function loadMetadata(
  gateways: RequiredComparisonGateways,
  sides: ResolvedSides,
  progress: FlowProgressReporter
): Promise<{ fromMetadata: JsonObject; toMetadata: JsonObject }> {
  progress('loading-metadata', sides.detail);
  const fromMetadata = await gateways.from.getVersionMetadata(sides.fromVersion.id);
  const sameVersion = gateways.from === gateways.to && sides.fromVersion.id === sides.toVersion.id;
  const toMetadata = sameVersion ? fromMetadata : await gateways.to.getVersionMetadata(sides.toVersion.id);
  return { fromMetadata, toMetadata };
}

export class FlowComparisonService {
  private readonly toGateway: (FlowDefinitionGateway & FlowMetadataGateway) | undefined;

  public constructor(
    private readonly fromGateway?: FlowDefinitionGateway & FlowMetadataGateway,
    toGateway?: FlowDefinitionGateway & FlowMetadataGateway
  ) {
    this.toGateway = toGateway ?? fromGateway;
  }

  public async compare(
    request: FlowCompareRequest,
    progress: FlowProgressReporter = noFlowProgress,
    sources: FlowCompareSources = {}
  ): Promise<FlowCompareResult> {
    if (
      !request.scopes.every((scope) => flowComparisonScopeSchema.safeParse(scope).success) ||
      request.ignorePaths.some((path) => path.trim().length === 0)
    ) {
      throw flowComparisonFailed('The Flow comparison scope is invalid.');
    }
    try {
      if (sources.from !== undefined || sources.to !== undefined) {
        return await compareFlowSources({
          gateways: { from: this.fromGateway, to: this.toGateway },
          request,
          sources,
          progress,
        });
      }
      const comparison = await resolveComparison(
        {
          from: requiredGateway(this.fromGateway, 'source'),
          to: requiredGateway(this.toGateway, 'target'),
        },
        request,
        progress
      );
      return createResult(request, comparison);
    } catch (error: unknown) {
      if (shouldRethrow(error)) {
        throw error;
      }
      throw flowComparisonFailed(`Failed to compare versions of Flow "${request.apiName}".`, error);
    }
  }
}
