/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowListFailed } from '../errors/flow-errors.js';
import { positiveFlowVersionSchema } from '../schemas/flow.js';
import type { FlowListEntry, FlowListRequest, FlowListResult, FlowListSort } from '../types/flow-list.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowSortOrder, FlowVersion } from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName } from '../utils/flow-state.js';

interface VersionReference {
  definition: FlowDefinition;
  versions: ReadonlyArray<FlowVersion>;
  versionId: string | null;
  role: 'active' | 'latest';
}

function groupVersions(versions: ReadonlyArray<FlowVersion>): ReadonlyMap<string, ReadonlyArray<FlowVersion>> {
  const grouped = new Map<string, FlowVersion[]>();
  for (const version of versions) {
    const current = grouped.get(version.definitionId) ?? [];
    current.push(version);
    grouped.set(version.definitionId, current);
  }
  return grouped;
}

function resolveVersion(reference: VersionReference): FlowVersion | null {
  if (reference.versionId === null) {
    return null;
  }
  const version = reference.versions.find((candidate) => candidate.id === reference.versionId);
  if (version === undefined) {
    throw flowListFailed(
      `Flow "${qualifiedFlowName(
        reference.definition.apiName,
        reference.definition.namespace
      )}" references an unavailable ${reference.role} version.`
    );
  }
  return version;
}

function createEntry(definition: FlowDefinition, versions: ReadonlyArray<FlowVersion>): FlowListEntry {
  const active = resolveVersion({ definition, versions, versionId: definition.activeVersionId, role: 'active' });
  const latest = resolveVersion({ definition, versions, versionId: definition.latestVersionId, role: 'latest' });
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    label: latest?.label ?? null,
    processType: latest?.processType ?? null,
    activeVersion: active?.versionNumber ?? null,
    latestVersion: latest?.versionNumber ?? null,
    status: latest?.status ?? null,
    lastModifiedDate: latest?.lastModifiedDate ?? null,
  };
}

function matchesFilters(entry: FlowListEntry, request: FlowListRequest): boolean {
  return (
    (request.apiNames.length === 0 || request.apiNames.includes(entry.apiName)) &&
    (request.types.length === 0 || (entry.processType !== null && request.types.includes(entry.processType))) &&
    (request.namespaces.length === 0 || (entry.namespace !== null && request.namespaces.includes(entry.namespace))) &&
    (request.statuses.length === 0 || (entry.status !== null && request.statuses.includes(entry.status)))
  );
}

function nullableText(value: string | null): string {
  return value ?? '';
}

function compareVersions(left: number | null, right: number | null): number {
  return (left ?? -1) - (right ?? -1);
}

function compareEntries(left: FlowListEntry, right: FlowListEntry, sort: FlowListSort): number {
  switch (sort) {
    case 'active-version':
      return compareVersions(left.activeVersion, right.activeVersion);
    case 'api-name':
      return qualifiedFlowName(left.apiName, left.namespace).localeCompare(
        qualifiedFlowName(right.apiName, right.namespace)
      );
    case 'label':
      return nullableText(left.label).localeCompare(nullableText(right.label));
    case 'latest-version':
      return compareVersions(left.latestVersion, right.latestVersion);
    case 'modified':
      return nullableText(left.lastModifiedDate).localeCompare(nullableText(right.lastModifiedDate));
    case 'type':
      return nullableText(left.processType).localeCompare(nullableText(right.processType));
  }
}

function sortEntries(entries: ReadonlyArray<FlowListEntry>, sort: FlowListSort, order: FlowSortOrder): FlowListEntry[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...entries].sort(
    (left, right) =>
      direction *
      (compareEntries(left, right, sort) ||
        qualifiedFlowName(left.apiName, left.namespace).localeCompare(
          qualifiedFlowName(right.apiName, right.namespace)
        ))
  );
}

function createResult(request: FlowListRequest, entries: ReadonlyArray<FlowListEntry>): FlowListResult {
  const filtered = sortEntries(
    entries.filter((entry) => matchesFilters(entry, request)),
    request.sort,
    request.order
  );
  return {
    targetOrg: request.targetOrg,
    filters: {
      apiNames: request.apiNames,
      types: request.types,
      namespaces: request.namespaces,
      statuses: request.statuses,
    },
    sort: request.sort,
    order: request.order,
    limit: request.limit ?? null,
    definitions: request.limit === undefined ? filtered : filtered.slice(0, request.limit),
  };
}

async function resolveList(
  gateway: FlowDefinitionGateway,
  request: FlowListRequest,
  progress: FlowProgressReporter
): Promise<FlowListResult> {
  progress('loading-flows', 'all Flow definitions');
  const definitions = await gateway.findAllDefinitions();
  progress('loading-versions', 'all Flow definitions (all versions)');
  const versions = groupVersions(await gateway.findAllVersions());
  progress('analysing-results', `${definitions.length} Flow definitions`);
  const entries = definitions.map((definition) => createEntry(definition, versions.get(definition.id) ?? []));
  return createResult(request, entries);
}

export class FlowListService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async list(
    request: FlowListRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowListResult> {
    if (request.limit !== undefined && !positiveFlowVersionSchema.safeParse(request.limit).success) {
      throw flowListFailed('The Flow list limit must be a positive integer.');
    }
    try {
      return await resolveList(this.gateway, request, progress);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'FlowListFailed') {
        throw error;
      }
      throw flowListFailed('Failed to list Flow definitions.', error);
    }
  }
}
