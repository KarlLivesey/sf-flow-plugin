/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';
import type { FlowSource } from './flow-source.js';

export type FlowComparisonVersionSelector = 'active' | 'latest' | FlowVersionNumber;

export type FlowDependencyDirection = 'uses' | 'used-by' | 'both';

export type FlowDependencyQueryDirection = Exclude<FlowDependencyDirection, 'both'>;

export type FlowDependencyFormat = 'table' | 'tree' | 'mermaid' | 'dot';

export type FlowComparisonFormat = 'summary' | 'unified' | 'markdown';

export type FlowComparisonScope = 'metadata' | 'elements' | 'resources' | 'connectors';

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

// A recursive JSON object cannot use Record without creating a circular type alias.
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface FlowMetadataRecord {
  Id: string;
  Metadata: JsonObject;
}

export interface MetadataComponentDependencyRecord {
  MetadataComponentId: string | null;
  MetadataComponentName: string | null;
  MetadataComponentNamespace: string | null;
  MetadataComponentType: string | null;
  RefMetadataComponentId: string | null;
  RefMetadataComponentName: string | null;
  RefMetadataComponentNamespace: string | null;
  RefMetadataComponentType: string | null;
}

export interface FlowDependencyGateway {
  findDependencies(
    definitionId: string,
    direction: FlowDependencyQueryDirection,
    types: ReadonlyArray<string>
  ): Promise<FlowDependencyQueryResult>;
}

export interface FlowMetadataGateway {
  getVersionMetadata(versionId: string): Promise<JsonObject>;
}

export interface FlowDependenciesRequest extends NamedFlowRequest {
  direction: FlowDependencyDirection;
  recursive: boolean;
  maxDepth: number;
  types: string[];
  excludeTypes: string[];
}

export interface IndexedFlowDependency {
  direction: FlowDependencyQueryDirection;
  componentId: string | null;
  name: string | null;
  namespace: string | null;
  type: string | null;
}

export interface FlowDependencyQueryResult {
  dependencies: IndexedFlowDependency[];
  reachedLimit: boolean;
  limit: number;
}

export interface FlowDependencyTruncation {
  definitionId: string;
  apiName: string;
  namespace: string | null;
  direction: FlowDependencyQueryDirection;
  depth: number;
  limit: number;
}

export interface FlowDependency extends IndexedFlowDependency {
  sourceDefinitionId: string;
  sourceApiName: string;
  sourceNamespace: string | null;
  depth: number;
}

export interface FlowDependenciesResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  direction: FlowDependencyDirection;
  recursive: boolean;
  maxDepth: number;
  types: string[];
  excludeTypes: string[];
  definitionsScanned: number;
  dependencies: FlowDependency[];
  truncated: boolean;
  truncations: FlowDependencyTruncation[];
  targetOrg: string;
}

export interface FlowCompareRequest extends Omit<NamedFlowRequest, 'namespace'> {
  namespace?: string | null;
  from: FlowComparisonVersionSelector;
  to: FlowComparisonVersionSelector;
  fromOrg: string;
  toOrg: string;
  scopes: FlowComparisonScope[];
  ignoreOrder: boolean;
  ignorePaths: string[];
}

export type FlowComparisonChangeKind = 'added' | 'removed' | 'changed';

export interface FlowComparisonChange {
  kind: FlowComparisonChangeKind;
  path: string;
  before?: JsonValue;
  after?: JsonValue;
}

export interface FlowCompareResult {
  apiName: string;
  namespace: string | null;
  definitionId: string | null;
  fromDefinitionId: string | null;
  toDefinitionId: string | null;
  requestedFrom: FlowComparisonVersionSelector | null;
  requestedTo: FlowComparisonVersionSelector | null;
  scopes: FlowComparisonScope[];
  ignoreOrder: boolean;
  ignorePaths: string[];
  fromVersion: FlowVersionNumber | null;
  toVersion: FlowVersionNumber | null;
  fromSourceFile: string | null;
  toSourceFile: string | null;
  changes: FlowComparisonChange[];
  added: number;
  removed: number;
  changed: number;
  different: boolean;
  targetOrg: string | null;
  fromOrg: string | null;
  toOrg: string | null;
  crossOrg: boolean;
}

export interface FlowCompareSources {
  from?: FlowSource;
  to?: FlowSource;
}
