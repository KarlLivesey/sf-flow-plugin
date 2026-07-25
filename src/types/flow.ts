/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export type FlowVersionNumber = number;

export type FlowVersionSelector = 'latest' | FlowVersionNumber;

export type FlowPruneOrder = 'created' | 'modified';

export type FlowMutationOperation = 'update-definition' | 'delete-version';

export type FlowErrorCode =
  | 'FlowDefinitionNotFound'
  | 'FlowDefinitionAmbiguous'
  | 'FlowVersionInvalid'
  | 'FlowVersionNotFound'
  | 'FlowVersionNotActivatable'
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
  versions: FlowVersionSummary[];
  targetOrg: string;
}

export interface FlowDeactivationRequest extends NamedFlowRequest {
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
  flows: FlowAuditEntry[];
}

export interface FlowPruneRequest extends NamedFlowRequest {
  keep: number;
  keepVersions: FlowVersionNumber[];
  ignoreVersions: FlowVersionNumber[];
  keepBy: FlowPruneOrder;
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
  keepBy: FlowPruneOrder;
  protectedVersions: FlowPruneVersion[];
  ignoredVersions: FlowPruneVersion[];
  retainedVersions: FlowPruneVersion[];
  plannedDeletions: FlowPruneVersion[];
  deletedVersions: FlowPruneVersion[];
  skippedVersions: FlowPruneVersion[];
  changed: boolean;
  dryRun: boolean;
  targetOrg: string;
}
