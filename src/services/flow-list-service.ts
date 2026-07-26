/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowListFailed } from '../errors/flow-errors.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowListEntry,
  FlowListRequest,
  FlowListResult,
  FlowVersion,
} from '../types/flow.js';
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
  const entries = definitions
    .map((definition) => createEntry(definition, versions.get(definition.id) ?? []))
    .sort((left, right) =>
      qualifiedFlowName(left.apiName, left.namespace).localeCompare(qualifiedFlowName(right.apiName, right.namespace))
    );
  return { targetOrg: request.targetOrg, definitions: entries };
}

export class FlowListService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async list(
    request: FlowListRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowListResult> {
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
