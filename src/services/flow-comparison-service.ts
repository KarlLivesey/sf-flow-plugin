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
  FlowComparisonChange,
  FlowComparisonVersionSelector,
  FlowMetadataGateway,
} from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import { compareFlowMetadata } from '../utils/flow-metadata-diff.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

interface VersionContext {
  definition: FlowDefinition;
  versions: ReadonlyArray<FlowVersion>;
}

interface ResolvedComparison {
  fromVersion: FlowVersion;
  toVersion: FlowVersion;
  changes: FlowComparisonChange[];
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

function changeCount(changes: ReadonlyArray<FlowComparisonChange>, kind: FlowComparisonChange['kind']): number {
  return changes.filter((change) => change.kind === kind).length;
}

function createResult(
  request: FlowCompareRequest,
  definition: FlowDefinition,
  comparison: ResolvedComparison
): FlowCompareResult {
  const { fromVersion, toVersion, changes } = comparison;
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    requestedFrom: request.from,
    requestedTo: request.to,
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
    fromVersion: fromVersion.versionNumber,
    toVersion: toVersion.versionNumber,
    changes,
    added: changeCount(changes, 'added'),
    removed: changeCount(changes, 'removed'),
    changed: changeCount(changes, 'changed'),
    different: changes.length > 0,
    targetOrg: request.targetOrg,
  };
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
  gateway: FlowDefinitionGateway & FlowMetadataGateway,
  request: FlowCompareRequest,
  progress: FlowProgressReporter
): Promise<{ definition: FlowDefinition; comparison: ResolvedComparison }> {
  const context = await resolveVersionContext(gateway, request, progress);
  const fromVersion = selectVersion(context, request.from);
  const toVersion = selectVersion(context, request.to);
  const name = qualifiedFlowName(context.definition.apiName, context.definition.namespace);
  progress('loading-metadata', `${name} v${fromVersion.versionNumber} → v${toVersion.versionNumber}`);
  const fromMetadata = await gateway.getVersionMetadata(fromVersion.id);
  const toMetadata = fromVersion.id === toVersion.id ? fromMetadata : await gateway.getVersionMetadata(toVersion.id);
  progress('comparing-metadata', `${name} v${fromVersion.versionNumber} → v${toVersion.versionNumber}`);
  const changes = compareFlowMetadata(fromMetadata, toMetadata, {
    scopes: request.scopes,
    ignoreOrder: request.ignoreOrder,
  });
  return { definition: context.definition, comparison: { fromVersion, toVersion, changes } };
}

async function resolveVersionContext(
  gateway: FlowDefinitionGateway,
  request: FlowCompareRequest,
  progress: FlowProgressReporter
): Promise<VersionContext> {
  progress('resolving-flow', request.apiName);
  const definition = selectFlowDefinition(request.apiName, await gateway.findDefinitions(createLookup(request)));
  progress(
    'loading-versions',
    `${qualifiedFlowName(definition.apiName, definition.namespace)} (${versionSelectorLabel(
      request.from
    )} → ${versionSelectorLabel(request.to)})`
  );
  return { definition, versions: await gateway.findVersions(definition.id) };
}

export class FlowComparisonService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async compare(
    request: FlowCompareRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowCompareResult> {
    if (!request.scopes.every((scope) => flowComparisonScopeSchema.safeParse(scope).success)) {
      throw flowComparisonFailed('The Flow comparison scope is invalid.');
    }
    try {
      const { definition, comparison } = await resolveComparison(this.gateway, request, progress);
      return createResult(request, definition, comparison);
    } catch (error: unknown) {
      if (shouldRethrow(error)) {
        throw error;
      }
      throw flowComparisonFailed(`Failed to compare versions of Flow "${request.apiName}".`, error);
    }
  }
}
