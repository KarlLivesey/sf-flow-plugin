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
import { assertExpectedActiveVersion } from '../utils/flow-concurrency.js';
import { qualifiedFlowName, resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

const PRUNABLE_STATUSES = new Set(['Draft', 'Obsolete', 'InvalidDraft']);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

interface PrunePlan {
  definition: FlowDefinition;
  protectedVersions: FlowPruneVersion[];
  recentVersions: FlowPruneVersion[];
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

function classifyVersions(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  statuses: ReadonlySet<string>
): PruneCandidates {
  const protectedVersions = versions.filter((version) => isProtected(definition, version));
  const candidates = versions.filter((version) => !isProtected(definition, version) && statuses.has(version.status));
  const skippedVersions = versions.filter(
    (version) => !isProtected(definition, version) && !statuses.has(version.status)
  );
  return { protectedVersions, candidates, skippedVersions };
}

function compareVersions(left: FlowVersion, right: FlowVersion, request: FlowPruneRequest): number {
  const leftDate = request.keepBy === 'created' ? left.createdDate : left.lastModifiedDate;
  const rightDate = request.keepBy === 'created' ? right.createdDate : right.lastModifiedDate;
  return rightDate.localeCompare(leftDate) || right.versionNumber - left.versionNumber;
}

function versionDate(version: FlowVersion, request: FlowPruneRequest): string {
  return request.keepBy === 'created' ? version.createdDate : version.lastModifiedDate;
}

function splitCandidatesByAge(
  candidates: ReadonlyArray<FlowVersion>,
  request: FlowPruneRequest,
  now: Date
): { eligible: FlowVersion[]; recent: FlowVersion[] } {
  if (request.olderThanDays === undefined) {
    return { eligible: [...candidates], recent: [] };
  }
  const cutoff = now.getTime() - request.olderThanDays * MILLISECONDS_PER_DAY;
  return {
    eligible: candidates.filter((version) => Date.parse(versionDate(version, request)) < cutoff),
    recent: candidates.filter((version) => Date.parse(versionDate(version, request)) >= cutoff),
  };
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
    request.statuses.length > 0 &&
    request.statuses.every((status) => PRUNABLE_STATUSES.has(status)) &&
    (request.olderThanDays === undefined || positiveFlowVersionSchema.safeParse(request.olderThanDays).success) &&
    (request.expectedActiveVersion === undefined ||
      positiveFlowVersionSchema.safeParse(request.expectedActiveVersion).success) &&
    [...request.keepVersions, ...request.ignoreVersions].every(
      (version) => positiveFlowVersionSchema.safeParse(version).success
    )
  );
}

function pruneCandidates(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  request: FlowPruneRequest
): PruneCandidates {
  const activeVersion = resolveVersionNumber(definition.apiName, definition.activeVersionId, versions);
  assertExpectedActiveVersion(request.apiName, request.expectedActiveVersion, activeVersion);
  return classifyVersions(definition, versions, new Set(request.statuses));
}

function createPlan(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  context: { request: FlowPruneRequest; now: Date }
): PrunePlan {
  const { request, now } = context;
  assertRequestedVersionsExist(request, versions);
  const classified = pruneCandidates(definition, versions, request);
  const age = splitCandidatesByAge(classified.candidates, request, now);
  const ignoredNumbers = new Set(request.ignoreVersions);
  const ignored = age.eligible.filter((version) => ignoredNumbers.has(version.versionNumber));
  const selectable = age.eligible.filter((version) => !ignoredNumbers.has(version.versionNumber));
  const retained = selectRetained(selectable, request);
  const retainedIds = new Set([...retained, ...ignored].map((version) => version.id));
  return {
    definition,
    protectedVersions: classified.protectedVersions.map(toPruneVersion),
    recentVersions: age.recent.map(toPruneVersion),
    ignoredVersions: ignored.map(toPruneVersion),
    retainedVersions: retained.map(toPruneVersion),
    plannedDeletions: age.eligible.filter((version) => !retainedIds.has(version.id)).map(toPruneVersion),
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
    statuses: [...new Set(request.statuses)],
    keepBy: request.keepBy,
    olderThanDays: request.olderThanDays ?? null,
    protectedVersions: plan.protectedVersions,
    recentVersions: plan.recentVersions,
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
  public constructor(
    private readonly gateway: FlowDefinitionGateway,
    private readonly now: () => Date = (): Date => new Date()
  ) {}

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
    await withFlowProgressStage(progress, {
      stage: 'checking-current-state',
      detail: `${name} (expected active v${request.expectedActiveVersion ?? 'any'})`,
      operation: async () => this.assertCurrentActiveVersion(request),
    });
    await this.deleteVersions(plan, progress);
    await withFlowProgressStage(progress, {
      stage: 'verifying-change',
      detail: `${name} (${plan.plannedDeletions.length} deleted versions)`,
      operation: async () => this.verify(plan),
    });
    return plan.plannedDeletions;
  }

  private async assertCurrentActiveVersion(request: FlowPruneRequest): Promise<void> {
    if (request.expectedActiveVersion === undefined) {
      return;
    }
    const definition = selectFlowDefinition(request.apiName, await this.gateway.findDefinitions(createLookup(request)));
    const versions = await this.gateway.findVersions(definition.id);
    const activeVersion = resolveVersionNumber(definition.apiName, definition.activeVersionId, versions);
    assertExpectedActiveVersion(request.apiName, request.expectedActiveVersion, activeVersion);
  }

  private async plan(request: FlowPruneRequest, progress: FlowProgressReporter): Promise<PrunePlan> {
    try {
      progress('resolving-flow', request.apiName);
      const definitions = await this.gateway.findDefinitions(createLookup(request));
      const definition = selectFlowDefinition(request.apiName, definitions);
      progress('loading-versions', `${qualifiedFlowName(definition.apiName, definition.namespace)} (all versions)`);
      return createPlan(definition, await this.gateway.findVersions(definition.id), { request, now: this.now() });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous', 'FlowActiveVersionMismatch'].includes(error.name)
      ) {
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
