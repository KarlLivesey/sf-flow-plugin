/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export type FlowVersionNumber = number;

export type FlowVersionSelector = 'latest' | FlowVersionNumber;

export type FlowPruneOrder = 'created' | 'modified';

export type FlowVersionStatusFilter = 'Active' | 'Draft' | 'InvalidDraft' | 'Obsolete';

export type FlowVersionSort = 'version' | 'created' | 'modified';

export type FlowSortOrder = 'asc' | 'desc';

export type FlowMutationOperation = 'update-definition' | 'delete-version';

export type FlowErrorCode =
  | 'FlowDefinitionNotFound'
  | 'FlowDefinitionAmbiguous'
  | 'FlowVersionInvalid'
  | 'FlowVersionNotFound'
  | 'FlowVersionNotActivatable'
  | 'FlowActiveVersionMismatch'
  | 'FlowQueryFailed'
  | 'FlowMutationFailed'
  | 'FlowMutationPermissionDenied'
  | 'FlowActivationFailed'
  | 'FlowActivationVerificationFailed'
  | 'FlowDeactivationFailed'
  | 'FlowDeactivationVerificationFailed'
  | 'FlowAuditFailed'
  | 'FlowDependenciesFailed'
  | 'FlowComparisonFailed'
  | 'FlowInspectionFailed'
  | 'FlowPruneFailed'
  | 'FlowPruneVerificationFailed';

export interface NamedFlowRequest {
  apiName: string;
  targetOrg: string;
  namespace?: string;
  apiVersion?: string;
}

export interface FlowActivationRequest extends NamedFlowRequest {
  requestedVersion: FlowVersionSelector;
  expectedActiveVersion?: FlowVersionNumber;
  dryRun: boolean;
}

export interface ToolingQueryResult<TRecord> {
  done: boolean;
  totalSize: number;
  records: TRecord[];
  nextRecordsUrl?: string;
}

export interface FlowDefinitionRecord {
  Id: string;
  DeveloperName: string;
  NamespacePrefix: string | null;
  ActiveVersionId: string | null;
  LatestVersionId: string | null;
}

export interface FlowVersionRecord {
  Id: string;
  DefinitionId: string;
  VersionNumber: number;
  Status: string;
  MasterLabel: string;
  ProcessType: string;
  CreatedDate: string;
  LastModifiedDate: string;
}

export interface FlowDefinition {
  id: string;
  apiName: string;
  namespace: string | null;
  activeVersionId: string | null;
  latestVersionId: string | null;
}

export interface FlowVersion {
  id: string;
  definitionId: string;
  versionNumber: FlowVersionNumber;
  status: string;
  label: string;
  processType: string;
  createdDate: string;
  lastModifiedDate: string;
}

export interface FlowActivationPlan {
  definition: FlowDefinition;
  requestedVersion: FlowVersionSelector;
  selectedVersion: FlowVersion;
  previousActiveVersion: FlowVersionNumber | null;
  changeRequired: boolean;
}

export interface FlowActivationResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  requestedVersion: FlowVersionSelector;
  resolvedVersion: FlowVersionNumber;
  previousActiveVersion: FlowVersionNumber | null;
  activeVersion: FlowVersionNumber;
  changed: boolean;
  dryRun: boolean;
  targetOrg: string;
}

export interface FlowDefinitionMetadataUpdate {
  Metadata: {
    activeVersionNumber: number;
  };
}

export interface FlowDefinitionLookup {
  apiName: string;
  namespace?: string;
}

export interface FlowDefinitionGateway {
  assertMutationAllowed(operation: FlowMutationOperation): Promise<void>;
  findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>>;
  findAllDefinitions(): Promise<ReadonlyArray<FlowDefinition>>;
  findVersions(definitionId: string): Promise<ReadonlyArray<FlowVersion>>;
  findAllVersions(): Promise<ReadonlyArray<FlowVersion>>;
  setActiveVersion(definitionId: string, versionNumber: FlowVersionNumber | null): Promise<void>;
  deleteVersion(versionId: string): Promise<void>;
}

export interface FlowDefinitionService {
  planActivation(request: FlowActivationRequest): Promise<FlowActivationPlan>;
  activate(request: FlowActivationRequest): Promise<FlowActivationResult>;
}

export interface FlowVersionSummary {
  id: string;
  versionNumber: FlowVersionNumber;
  status: string;
  label: string;
  processType: string;
  createdDate: string;
  lastModifiedDate: string;
  active: boolean;
  latest: boolean;
}

export interface FlowVersionsResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  activeVersion: FlowVersionNumber | null;
  latestVersion: FlowVersionNumber | null;
  statuses: FlowVersionStatusFilter[];
  createdBefore: string | null;
  createdAfter: string | null;
  sort: FlowVersionSort;
  order: FlowSortOrder;
  versions: FlowVersionSummary[];
  targetOrg: string;
}

export interface FlowVersionsRequest extends NamedFlowRequest {
  statuses: FlowVersionStatusFilter[];
  createdBefore?: string;
  createdAfter?: string;
  sort: FlowVersionSort;
  order: FlowSortOrder;
  limit?: number;
}

export interface FlowDeactivationRequest extends NamedFlowRequest {
  expectedActiveVersion?: FlowVersionNumber;
  dryRun: boolean;
}

export interface FlowDeactivationResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  previousActiveVersion: FlowVersionNumber | null;
  activeVersion: null;
  changed: boolean;
  dryRun: boolean;
  targetOrg: string;
}

export type FlowAuditIssueCode =
  | 'ActiveVersionBehindLatest'
  | 'NoActiveVersion'
  | 'DraftVersionsPresent'
  | 'ObsoleteVersionsPresent';

export interface FlowAuditEntry {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  activeVersion: FlowVersionNumber | null;
  latestVersion: FlowVersionNumber | null;
  draftVersions: number;
  obsoleteVersions: number;
  issues: FlowAuditIssueCode[];
}

export interface FlowAuditResult {
  targetOrg: string;
  definitionsScanned: number;
  flowsWithIssues: number;
  maxInactiveVersions: number;
  olderThanDays: number | null;
  types: string[];
  namespace: string | null;
  flows: FlowAuditEntry[];
}

export interface FlowAuditRequest {
  targetOrg: string;
  apiNames: string[];
  types: string[];
  namespace?: string;
  maxInactiveVersions: number;
  olderThanDays?: number;
}

export interface FlowPruneRequest extends NamedFlowRequest {
  keep: number;
  keepVersions: FlowVersionNumber[];
  ignoreVersions: FlowVersionNumber[];
  statuses: FlowVersionStatusFilter[];
  keepBy: FlowPruneOrder;
  olderThanDays?: number;
  expectedActiveVersion?: FlowVersionNumber;
  dryRun: boolean;
}

export interface FlowPruneVersion {
  id: string;
  versionNumber: FlowVersionNumber;
  status: string;
  createdDate: string;
  lastModifiedDate: string;
}

export interface FlowPruneResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  keep: number;
  keepVersions: FlowVersionNumber[];
  ignoreVersions: FlowVersionNumber[];
  statuses: FlowVersionStatusFilter[];
  keepBy: FlowPruneOrder;
  olderThanDays: number | null;
  protectedVersions: FlowPruneVersion[];
  recentVersions: FlowPruneVersion[];
  ignoredVersions: FlowPruneVersion[];
  retainedVersions: FlowPruneVersion[];
  plannedDeletions: FlowPruneVersion[];
  deletedVersions: FlowPruneVersion[];
  skippedVersions: FlowPruneVersion[];
  changed: boolean;
  dryRun: boolean;
  targetOrg: string;
}
