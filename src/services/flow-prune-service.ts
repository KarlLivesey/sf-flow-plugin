/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowPruneFailed, flowPruneVerificationFailed } from '../errors/flow-errors.js';
import { flowPruneOrderSchema, nonnegativeIntegerSchema, positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowPruneRequest,
  FlowPruneResult,
  FlowPruneVersion,
  FlowVersion,
} from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter, withFlowProgressStage } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

const PRUNABLE_STATUSES = new Set(['Draft', 'Obsolete', 'InvalidDraft']);

interface PrunePlan {
  definition: FlowDefinition;
  protectedVersions: FlowPruneVersion[];
  ignoredVersions: FlowPruneVersion[];
  retainedVersions: FlowPruneVersion[];
  plannedDeletions: FlowPruneVersion[];
  skippedVersions: FlowPruneVersion[];
}

interface PruneCandidates {
  protectedVersions: FlowVersion[];
  candidates: FlowVersion[];
  skippedVersions: FlowVersion[];
}

function createLookup(request: FlowPruneRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function toPruneVersion(version: FlowVersion): FlowPruneVersion {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    createdDate: version.createdDate,
    lastModifiedDate: version.lastModifiedDate,
  };
}

function isProtected(definition: FlowDefinition, version: FlowVersion): boolean {
  return version.id === definition.activeVersionId || version.id === definition.latestVersionId;
}

function classifyVersions(definition: FlowDefinition, versions: ReadonlyArray<FlowVersion>): PruneCandidates {
  const protectedVersions = versions.filter((version) => isProtected(definition, version));
  const candidates = versions.filter(
    (version) => !isProtected(definition, version) && PRUNABLE_STATUSES.has(version.status)
  );
  const skippedVersions = versions.filter(
    (version) => !isProtected(definition, version) && !PRUNABLE_STATUSES.has(version.status)
  );
  return { protectedVersions, candidates, skippedVersions };
}

function compareVersions(left: FlowVersion, right: FlowVersion, request: FlowPruneRequest): number {
  const leftDate = request.keepBy === 'created' ? left.createdDate : left.lastModifiedDate;
  const rightDate = request.keepBy === 'created' ? right.createdDate : right.lastModifiedDate;
  return rightDate.localeCompare(leftDate) || right.versionNumber - left.versionNumber;
}

function selectRetained(candidates: ReadonlyArray<FlowVersion>, request: FlowPruneRequest): ReadonlyArray<FlowVersion> {
  const requested = new Set(request.keepVersions);
  const pinned = candidates.filter((version) => requested.has(version.versionNumber));
  if (pinned.length > request.keep) {
    throw flowPruneFailed('--keep must be at least the number of prunable --keep-version values.');
  }
  const unpinned = candidates
    .filter((version) => !requested.has(version.versionNumber))
    .sort((left, right) => compareVersions(left, right, request));
  return [...pinned, ...unpinned.slice(0, request.keep - pinned.length)];
}

function assertRequestedVersionsExist(request: FlowPruneRequest, versions: ReadonlyArray<FlowVersion>): void {
  const existing = new Set(versions.map((version) => version.versionNumber));
  const requested = [...request.keepVersions, ...request.ignoreVersions];
  const missing = requested.find((version) => !existing.has(version));
  if (missing !== undefined) {
    throw flowPruneFailed(`Flow "${request.apiName}" does not have requested version ${missing}.`);
  }
}

function validPruneRequest(request: FlowPruneRequest): boolean {
  return (
    nonnegativeIntegerSchema.safeParse(request.keep).success &&
    flowPruneOrderSchema.safeParse(request.keepBy).success &&
    [...request.keepVersions, ...request.ignoreVersions].every(
      (version) => positiveFlowVersionSchema.safeParse(version).success
    )
  );
}

function createPlan(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  request: FlowPruneRequest
): PrunePlan {
  assertRequestedVersionsExist(request, versions);
  const classified = classifyVersions(definition, versions);
  const ignoredNumbers = new Set(request.ignoreVersions);
  const ignored = classified.candidates.filter((version) => ignoredNumbers.has(version.versionNumber));
  const selectable = classified.candidates.filter((version) => !ignoredNumbers.has(version.versionNumber));
  const retained = selectRetained(selectable, request);
  const retainedIds = new Set(retained.map((version) => version.id));
  const ignoredIds = new Set(ignored.map((version) => version.id));
  return {
    definition,
    protectedVersions: classified.protectedVersions.map(toPruneVersion),
    ignoredVersions: ignored.map(toPruneVersion),
    retainedVersions: retained.map(toPruneVersion),
    plannedDeletions: classified.candidates
      .filter((version) => !retainedIds.has(version.id) && !ignoredIds.has(version.id))
      .map(toPruneVersion),
    skippedVersions: classified.skippedVersions.map(toPruneVersion),
  };
}

function createResult(
  request: FlowPruneRequest,
  plan: PrunePlan,
  deletedVersions: FlowPruneVersion[]
): FlowPruneResult {
  const ignoredNumbers = new Set(request.ignoreVersions);
  return {
    apiName: plan.definition.apiName,
    namespace: plan.definition.namespace,
    definitionId: plan.definition.id,
    keep: request.keep,
    keepVersions: [...new Set(request.keepVersions)].filter((version) => !ignoredNumbers.has(version)),
    ignoreVersions: [...new Set(request.ignoreVersions)],
    keepBy: request.keepBy,
    protectedVersions: plan.protectedVersions,
    ignoredVersions: plan.ignoredVersions,
    retainedVersions: plan.retainedVersions,
    plannedDeletions: plan.plannedDeletions,
    deletedVersions,
    skippedVersions: plan.skippedVersions,
    changed: deletedVersions.length > 0,
    dryRun: request.dryRun,
    targetOrg: request.targetOrg,
  };
}

export class FlowPruneService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async prune(
    request: FlowPruneRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowPruneResult> {
    if (!validPruneRequest(request)) {
      throw flowPruneFailed('The Flow prune retention options are invalid.');
    }
    const plan = await this.plan(request, progress);
    const deletedVersions = await this.executePlan(request, plan, progress);
    return createResult(request, plan, deletedVersions);
  }

  private async executePlan(
    request: FlowPruneRequest,
    plan: PrunePlan,
    progress: FlowProgressReporter
  ): Promise<FlowPruneVersion[]> {
    if (plan.plannedDeletions.length === 0) {
      return [];
    }
    const name = qualifiedFlowName(plan.definition.apiName, plan.definition.namespace);
    await withFlowProgressStage(progress, {
      stage: 'checking-permissions',
      detail: `${name} (delete Flow versions)`,
      operation: async () => this.gateway.assertMutationAllowed('delete-version'),
    });
    if (request.dryRun) {
      return [];
    }
    await this.deleteVersions(plan, progress);
    await withFlowProgressStage(progress, {
      stage: 'verifying-change',
      detail: `${name} (${plan.plannedDeletions.length} deleted versions)`,
      operation: async () => this.verify(plan),
    });
    return plan.plannedDeletions;
  }

  private async plan(request: FlowPruneRequest, progress: FlowProgressReporter): Promise<PrunePlan> {
    try {
      progress('resolving-flow', request.apiName);
      const definitions = await this.gateway.findDefinitions(createLookup(request));
      const definition = selectFlowDefinition(request.apiName, definitions);
      progress('loading-versions', `${qualifiedFlowName(definition.apiName, definition.namespace)} (all versions)`);
      return createPlan(definition, await this.gateway.findVersions(definition.id), request);
    } catch (error: unknown) {
      if (error instanceof Error && ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous'].includes(error.name)) {
        throw error;
      }
      throw flowPruneFailed(`Failed to plan pruning for Flow "${request.apiName}".`, error);
    }
  }

  private async deleteVersions(plan: PrunePlan, progress: FlowProgressReporter): Promise<void> {
    try {
      await plan.plannedDeletions.reduce(async (previous, version) => {
        await previous;
        progress(
          'deleting-versions',
          `${qualifiedFlowName(plan.definition.apiName, plan.definition.namespace)} v${version.versionNumber}`
        );
        await this.gateway.deleteVersion(version.id);
      }, Promise.resolve());
    } catch (error: unknown) {
      throw flowPruneFailed(`Failed to prune Flow "${plan.definition.apiName}".`, error);
    }
  }

  private async verify(plan: PrunePlan): Promise<void> {
    const remaining = await this.gateway.findVersions(plan.definition.id);
    const remainingIds = new Set(remaining.map((version) => version.id));
    if (plan.plannedDeletions.some((version) => remainingIds.has(version.id))) {
      throw flowPruneVerificationFailed(plan.definition.apiName);
    }
  }
}
