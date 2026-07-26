/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowAuditFailed } from '../errors/flow-errors.js';
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

function countStatus(versions: ReadonlyArray<FlowVersion>, status: string): number {
  return versions.filter((version) => version.status === status).length;
}

function createIssues(counts: AuditCounts): FlowAuditIssueCode[] {
  const issues: FlowAuditIssueCode[] = [];
  if (counts.activeVersion === null) {
    issues.push('NoActiveVersion');
  } else if (counts.latestVersion !== null && counts.activeVersion < counts.latestVersion) {
    issues.push('ActiveVersionBehindLatest');
  }
  if (counts.draftVersions > 0) {
    issues.push('DraftVersionsPresent');
  }
  if (counts.obsoleteVersions > 0) {
    issues.push('ObsoleteVersionsPresent');
  }
  return issues;
}

function createEntry(definition: FlowDefinition, versions: ReadonlyArray<FlowVersion>): FlowAuditEntry {
  const activeVersion = resolveVersionNumber(definition.apiName, definition.activeVersionId, versions);
  const latestVersion = resolveVersionNumber(definition.apiName, definition.latestVersionId, versions);
  const draftVersions = countStatus(versions, 'Draft');
  const obsoleteVersions = countStatus(versions, 'Obsolete');
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion,
    latestVersion,
    draftVersions,
    obsoleteVersions,
    issues: createIssues({ activeVersion, latestVersion, draftVersions, obsoleteVersions }),
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
  apiNames: ReadonlyArray<string>
): Promise<ReadonlyArray<FlowDefinition>> {
  if (apiNames.length === 0) {
    return gateway.findAllDefinitions();
  }
  const uniqueNames = [...new Set(apiNames)];
  return (await Promise.all(uniqueNames.map((apiName) => gateway.findDefinitions({ apiName })))).flat();
}

async function loadVersions(
  gateway: FlowDefinitionGateway,
  definitions: ReadonlyArray<FlowDefinition>,
  filtered: boolean
): Promise<ReadonlyArray<FlowVersion>> {
  if (!filtered) {
    return gateway.findAllVersions();
  }
  return (await Promise.all(definitions.map((definition) => gateway.findVersions(definition.id)))).flat();
}

export class FlowAuditService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async audit(
    request: FlowAuditRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowAuditResult> {
    try {
      const scope = request.apiNames.length === 0 ? 'all Flow definitions' : request.apiNames.join(', ');
      progress('loading-flows', scope);
      const definitions = await loadDefinitions(this.gateway, request.apiNames);
      progress('loading-versions', `${scope} (all versions)`);
      const versions = groupVersions(await loadVersions(this.gateway, definitions, request.apiNames.length > 0));
      progress('analysing-results', `${definitions.length} Flow definitions`);
      const flows = definitions
        .map((definition) => createEntry(definition, versions.get(definition.id) ?? []))
        .filter((entry) => entry.issues.length > 0);
      return {
        targetOrg: request.targetOrg,
        definitionsScanned: definitions.length,
        flowsWithIssues: flows.length,
        flows,
      };
    } catch (error: unknown) {
      throw flowAuditFailed('Failed to audit Flow definitions.', error);
    }
  }
}
