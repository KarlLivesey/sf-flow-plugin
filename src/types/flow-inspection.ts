/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';
import type { FlowComparisonVersionSelector } from './flow-analysis.js';

export type FlowGraphFormat = 'mermaid' | 'dot';

export type FlowSubflowVersionSelector = 'active' | 'latest';

export interface FlowTraversalRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  recursive: boolean;
  maxDepth: number;
}

export type FlowDescribeRequest = FlowTraversalRequest;

export interface FlowGraphRequest extends FlowTraversalRequest {
  format: FlowGraphFormat;
  includeVariables: boolean;
  includeFormulas: boolean;
}

export interface FlowVariableSummary {
  name: string;
  dataType: string;
  objectType: string | null;
  apexClass: string | null;
  collection: boolean;
  input: boolean;
  output: boolean;
  description: string | null;
}

export interface FlowFormulaSummary {
  name: string;
  dataType: string;
  expression: string;
  scale: number | null;
}

export interface FlowApexActionSummary {
  name: string;
  label: string | null;
  actionName: string | null;
  actionType: string;
}

export interface FlowSubflowSummary {
  name: string;
  label: string | null;
  flowName: string;
}

export interface FlowElementSummary {
  name: string;
  label: string | null;
  type: string;
}

export interface FlowConnectorSummary {
  source: string;
  target: string;
  label: string | null;
}

export interface FlowDescription {
  apiName: string;
  namespace: string | null;
  qualifiedName: string;
  definitionId: string;
  versionId: string;
  versionNumber: FlowVersionNumber;
  status: string;
  label: string;
  processType: string;
  depth: number;
  variables: FlowVariableSummary[];
  formulas: FlowFormulaSummary[];
  apexActions: FlowApexActionSummary[];
  subflows: FlowSubflowSummary[];
  referencedObjects: string[];
  elements: FlowElementSummary[];
  connectors: FlowConnectorSummary[];
}

export type FlowTraversalWarningKind =
  | 'depth-limit'
  | 'missing-subflow'
  | 'subflow-version-fallback'
  | 'missing-subflow-version';

export interface FlowTraversalWarning {
  kind: FlowTraversalWarningKind;
  flowName: string;
  path: string[];
}

export interface FlowDescribeResult {
  apiName: string;
  namespace: string | null;
  requestedVersion: FlowComparisonVersionSelector;
  resolvedVersion: FlowVersionNumber;
  subflowVersion: FlowSubflowVersionSelector;
  recursive: boolean;
  maxDepth: number;
  flows: FlowDescription[];
  warnings: FlowTraversalWarning[];
  targetOrg: string;
}

export interface FlowGraphResult extends FlowDescribeResult {
  format: FlowGraphFormat;
  includeVariables: boolean;
  includeFormulas: boolean;
  graph: string;
}
