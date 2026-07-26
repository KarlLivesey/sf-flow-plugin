/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';

export type FlowComparisonVersionSelector = 'active' | 'latest' | FlowVersionNumber;

export type FlowDependencyDirection = 'uses' | 'used-by' | 'both';

export type FlowDependencyQueryDirection = Exclude<FlowDependencyDirection, 'both'>;

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
  ): Promise<ReadonlyArray<IndexedFlowDependency>>;
}

export interface FlowMetadataGateway {
  getVersionMetadata(versionId: string): Promise<JsonObject>;
}

export interface FlowDependenciesRequest extends NamedFlowRequest {
  direction: FlowDependencyDirection;
  recursive: boolean;
  maxDepth: number;
  types: string[];
}

export interface IndexedFlowDependency {
  direction: FlowDependencyQueryDirection;
  componentId: string | null;
  name: string | null;
  namespace: string | null;
  type: string | null;
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
  definitionsScanned: number;
  dependencies: FlowDependency[];
  targetOrg: string;
}

export interface FlowCompareRequest extends NamedFlowRequest {
  from: FlowComparisonVersionSelector;
  to: FlowComparisonVersionSelector;
  fromOrg: string;
  toOrg: string;
  scopes: FlowComparisonScope[];
  ignoreOrder: boolean;
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
  definitionId: string;
  fromDefinitionId: string;
  toDefinitionId: string;
  requestedFrom: FlowComparisonVersionSelector;
  requestedTo: FlowComparisonVersionSelector;
  scopes: FlowComparisonScope[];
  ignoreOrder: boolean;
  fromVersion: FlowVersionNumber;
  toVersion: FlowVersionNumber;
  changes: FlowComparisonChange[];
  added: number;
  removed: number;
  changed: number;
  different: boolean;
  targetOrg: string;
  fromOrg: string;
  toOrg: string;
  crossOrg: boolean;
}
