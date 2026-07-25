/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export type FlowVersionNumber = number;

export type FlowVersionSelector = 'latest' | FlowVersionNumber;

export type FlowActivationErrorCode =
  | 'FlowDefinitionNotFound'
  | 'FlowDefinitionAmbiguous'
  | 'FlowVersionInvalid'
  | 'FlowVersionNotFound'
  | 'FlowVersionNotActivatable'
  | 'FlowActivationFailed'
  | 'FlowActivationVerificationFailed';

export interface FlowActivationRequest {
  apiName: string;
  targetOrg: string;
  requestedVersion: FlowVersionSelector;
  namespace?: string;
  apiVersion?: string;
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
    activeVersionNumber: FlowVersionNumber;
  };
}

export interface FlowDefinitionLookup {
  apiName: string;
  namespace?: string;
}

export interface FlowDefinitionGateway {
  findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>>;
  findVersions(definitionId: string): Promise<ReadonlyArray<FlowVersion>>;
  updateActiveVersion(definitionId: string, versionNumber: FlowVersionNumber): Promise<void>;
}

export interface FlowDefinitionService {
  planActivation(request: FlowActivationRequest): Promise<FlowActivationPlan>;
  activate(request: FlowActivationRequest): Promise<FlowActivationResult>;
}
