/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowAuditFailed } from '../errors/flow-errors.js';
import {
  flowProcessTypeSchema,
  namespaceSchema,
  nonnegativeIntegerSchema,
  positiveFlowVersionSchema,
} from '../schemas/flow.js';
import type {
  FlowAuditEntry,
  FlowAuditIssueCode,
  FlowAuditRequest,
  FlowAuditResult,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowVersion,
} from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { resolveVersionNumber } from '../utils/flow-state.js';

interface AuditCounts {
  activeVersion: number | null;
  latestVersion: number | null;
  draftVersions: number;
  obsoleteVersions: number;
}

interface AuditOptions {
  maxInactiveVersions: number;
  inactiveCutoff: number | null;
}

interface AuditResolutionContext {
  gateway: FlowDefinitionGateway;
  request: FlowAuditRequest;
  progress: FlowProgressReporter;
  now: Date;
}

interface AuditEntryContext {
  definitions: ReadonlyArray<FlowDefinition>;
  versions: ReadonlyMap<string, ReadonlyArray<FlowVersion>>;
  request: FlowAuditRequest;
  now: Date;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function countStatus(versions: ReadonlyArray<FlowVersion>, status: string): number {
  return versions.filter((version) => version.status === status).length;
}

function createIssues(counts: AuditCounts, maxInactiveVersions: number): FlowAuditIssueCode[] {
  const issues: FlowAuditIssueCode[] = [];
  if (counts.activeVersion === null) {
    issues.push('NoActiveVersion');
  } else if (counts.latestVersion !== null && counts.activeVersion < counts.latestVersion) {
    issues.push('ActiveVersionBehindLatest');
  }
  if (counts.draftVersions + counts.obsoleteVersions > maxInactiveVersions) {
    if (counts.draftVersions > 0) {
      issues.push('DraftVersionsPresent');
    }
    if (counts.obsoleteVersions > 0) {
      issues.push('ObsoleteVersionsPresent');
    }
  }
  return issues;
}

function createEntry(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  options: AuditOptions
): FlowAuditEntry {
  const activeVersion = resolveVersionNumber(definition.apiName, definition.activeVersionId, versions);
  const latestVersion = resolveVersionNumber(definition.apiName, definition.latestVersionId, versions);
  const cutoff = options.inactiveCutoff;
  const inactiveVersions =
    cutoff === null ? versions : versions.filter((version) => Date.parse(version.lastModifiedDate) < cutoff);
  const draftVersions = countStatus(inactiveVersions, 'Draft');
  const obsoleteVersions = countStatus(inactiveVersions, 'Obsolete');
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion,
    latestVersion,
    draftVersions,
    obsoleteVersions,
    issues: createIssues(
      { activeVersion, latestVersion, draftVersions, obsoleteVersions },
      options.maxInactiveVersions
    ),
  };
}

function groupVersions(versions: ReadonlyArray<FlowVersion>): ReadonlyMap<string, ReadonlyArray<FlowVersion>> {
  const grouped = new Map<string, FlowVersion[]>();
  for (const version of versions) {
    const existing = grouped.get(version.definitionId) ?? [];
    existing.push(version);
    grouped.set(version.definitionId, existing);
  }
  return grouped;
}

async function loadDefinitions(
  gateway: FlowDefinitionGateway,
  request: FlowAuditRequest
): Promise<ReadonlyArray<FlowDefinition>> {
  if (request.apiNames.length === 0) {
    const definitions = await gateway.findAllDefinitions();
    return request.namespace === undefined
      ? definitions
      : definitions.filter((definition) => definition.namespace === request.namespace);
  }
  const uniqueNames = [...new Set(request.apiNames)];
  return (
    await Promise.all(
      uniqueNames.map((apiName) =>
        gateway.findDefinitions(
          request.namespace === undefined ? { apiName } : { apiName, namespace: request.namespace }
        )
      )
    )
  ).flat();
}

async function loadVersions(
  gateway: FlowDefinitionGateway,
  definitions: ReadonlyArray<FlowDefinition>,
  selectedByApiName: boolean
): Promise<ReadonlyArray<FlowVersion>> {
  if (!selectedByApiName) {
    return gateway.findAllVersions();
  }
  return (await Promise.all(definitions.map((definition) => gateway.findVersions(definition.id)))).flat();
}

function validateAuditRequest(request: FlowAuditRequest): void {
  if (
    !nonnegativeIntegerSchema.safeParse(request.maxInactiveVersions).success ||
    (request.olderThanDays !== undefined && !positiveFlowVersionSchema.safeParse(request.olderThanDays).success) ||
    !request.types.every((type) => flowProcessTypeSchema.safeParse(type).success) ||
    (request.namespace !== undefined && !namespaceSchema.safeParse(request.namespace).success)
  ) {
    throw flowAuditFailed('The Flow audit filters or thresholds are invalid.');
  }
}

function filterDefinitionsByType(
  definitions: ReadonlyArray<FlowDefinition>,
  versions: ReadonlyMap<string, ReadonlyArray<FlowVersion>>,
  types: ReadonlyArray<string>
): ReadonlyArray<FlowDefinition> {
  if (types.length === 0) {
    return definitions;
  }
  const accepted = new Set(types);
  return definitions.filter((definition) => {
    const latest = (versions.get(definition.id) ?? []).find((version) => version.id === definition.latestVersionId);
    return latest !== undefined && accepted.has(latest.processType);
  });
}

function auditScope(request: FlowAuditRequest): string {
  const names = request.apiNames.length === 0 ? 'all Flow definitions' : request.apiNames.join(', ');
  const namespace = request.namespace === undefined ? '' : `; namespace ${request.namespace}`;
  const types = request.types.length === 0 ? '' : `; types ${request.types.join(', ')}`;
  return `${names}${namespace}${types}`;
}

function createAuditEntries(context: AuditEntryContext): FlowAuditEntry[] {
  const { definitions, versions, request, now } = context;
  const inactiveCutoff =
    request.olderThanDays === undefined ? null : now.getTime() - request.olderThanDays * MILLISECONDS_PER_DAY;
  return definitions
    .map((definition) =>
      createEntry(definition, versions.get(definition.id) ?? [], {
        maxInactiveVersions: request.maxInactiveVersions,
        inactiveCutoff,
      })
    )
    .filter((entry) => entry.issues.length > 0);
}

async function resolveAudit(context: AuditResolutionContext): Promise<FlowAuditResult> {
  const { gateway, request, progress, now } = context;
  const scope = auditScope(request);
  progress('loading-flows', scope);
  const definitions = await loadDefinitions(gateway, request);
  progress('loading-versions', `${scope} (all versions)`);
  const versions = groupVersions(await loadVersions(gateway, definitions, request.apiNames.length > 0));
  const filteredDefinitions = filterDefinitionsByType(definitions, versions, request.types);
  progress('analysing-results', `${filteredDefinitions.length} Flow definitions`);
  const flows = createAuditEntries({ definitions: filteredDefinitions, versions, request, now });
  return {
    targetOrg: request.targetOrg,
    definitionsScanned: filteredDefinitions.length,
    flowsWithIssues: flows.length,
    maxInactiveVersions: request.maxInactiveVersions,
    olderThanDays: request.olderThanDays ?? null,
    types: request.types,
    namespace: request.namespace ?? null,
    flows,
  };
}

export class FlowAuditService {
  public constructor(
    private readonly gateway: FlowDefinitionGateway,
    private readonly now: () => Date = (): Date => new Date()
  ) {}

  public async audit(
    request: FlowAuditRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowAuditResult> {
    validateAuditRequest(request);
    try {
      return await resolveAudit({ gateway: this.gateway, request, progress, now: this.now() });
    } catch (error: unknown) {
      throw flowAuditFailed('Failed to audit Flow definitions.', error);
    }
  }
}
