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
  FlowAuditResult,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowVersion,
} from '../types/flow.js';
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

export class FlowAuditService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async audit(targetOrg: string): Promise<FlowAuditResult> {
    try {
      const definitions = await this.gateway.findAllDefinitions();
      const versions = groupVersions(await this.gateway.findAllVersions());
      const flows = definitions
        .map((definition) => createEntry(definition, versions.get(definition.id) ?? []))
        .filter((entry) => entry.issues.length > 0);
      return {
        targetOrg,
        definitionsScanned: definitions.length,
        flowsWithIssues: flows.length,
        flows,
      };
    } catch (error: unknown) {
      throw flowAuditFailed('Failed to audit Flow definitions.', error);
    }
  }
}
