/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowGraphNamedColor } from '../constants/flow-graph-colors.js';
import type { FlowComparisonVersionSelector } from './flow-analysis.js';
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';

export type FlowGraphFormat = 'mermaid' | 'dot';

export type FlowGraphDirection = 'auto' | 'left-right' | 'top-down';

export type FlowGraphResolvedDirection = Exclude<FlowGraphDirection, 'auto'>;

export type FlowGraphLayout = 'auto' | 'dagre' | 'elk';

export type FlowGraphResolvedLayout = Exclude<FlowGraphLayout, 'auto'>;

export type FlowGraphLayoutSelection = FlowGraphLayout | FlowGraphLayout[];

export type FlowGraphCurve = 'auto' | 'basis' | 'linear' | 'step' | 'step-after' | 'step-before';

export type FlowGraphResolvedCurve = Exclude<FlowGraphCurve, 'auto'>;

export type FlowGraphElkNodePlacement = 'auto' | 'brandes-koepf' | 'linear-segments' | 'network-simplex' | 'simple';

export type FlowGraphResolvedElkNodePlacement = Exclude<FlowGraphElkNodePlacement, 'auto'>;

export type FlowGraphElkModelOrder = 'auto' | 'none' | 'nodes-and-edges' | 'prefer-edges' | 'prefer-nodes';

export type FlowGraphResolvedElkModelOrder = Exclude<FlowGraphElkModelOrder, 'auto'>;

export type FlowGraphElkCycleBreaking =
  | 'auto'
  | 'depth-first'
  | 'greedy'
  | 'greedy-model-order'
  | 'interactive'
  | 'model-order';

export type FlowGraphResolvedElkCycleBreaking = Exclude<FlowGraphElkCycleBreaking, 'auto'>;

export interface FlowGraphElkOptions {
  nodePlacement: FlowGraphElkNodePlacement;
  modelOrder: FlowGraphElkModelOrder;
  cycleBreaking: FlowGraphElkCycleBreaking;
  mergeEdges: boolean;
  forceNodeOrder: boolean;
}

export interface FlowGraphResolvedElkOptions {
  nodePlacement: FlowGraphResolvedElkNodePlacement;
  modelOrder: FlowGraphResolvedElkModelOrder;
  cycleBreaking: FlowGraphResolvedElkCycleBreaking;
  mergeEdges: boolean;
  forceNodeOrder: boolean;
}

export type FlowGraphColorRole =
  | 'background'
  | 'cluster'
  | 'text'
  | 'node'
  | 'start'
  | 'decision'
  | 'subflow'
  | 'action'
  | 'record'
  | 'screen'
  | 'resource'
  | 'connector'
  | 'call'
  | 'outcome'
  | 'default'
  | 'fault';

export type FlowGraphColor = FlowGraphNamedColor | `#${string}`;

export type FlowGraphColorOverrides = Partial<Record<FlowGraphColorRole, FlowGraphColor>>;

export interface FlowGraphStyle {
  colors: FlowGraphColorOverrides;
  fontFamily: string;
  fontSize: number;
}

export type FlowSubflowVersionSelector = 'active' | 'latest';

export type FlowDescribeSection = 'elements' | 'inputs' | 'outputs' | 'references' | 'resources';

export interface FlowTraversalRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  recursive: boolean;
  maxDepth: number;
}

export interface FlowDescribeRequest extends FlowTraversalRequest {
  sections?: FlowDescribeSection[];
}

export type FlowLintRule =
  | 'dml-inside-loop'
  | 'hard-coded-id'
  | 'inactive-subflow'
  | 'missing-fault-path'
  | 'missing-subflow'
  | 'unconnected-element'
  | 'unused-resource';

export type FlowLintSeverity = 'error' | 'warning';

export interface FlowLintRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
}

export interface FlowLintFinding {
  rule: FlowLintRule;
  severity: FlowLintSeverity;
  message: string;
  element: string | null;
  path: string | null;
}

export interface FlowLintResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  requestedVersion: FlowComparisonVersionSelector;
  resolvedVersion: FlowVersionNumber;
  status: string;
  findings: FlowLintFinding[];
  errors: number;
  warnings: number;
  targetOrg: string;
}

export interface FlowGraphRequest extends FlowTraversalRequest {
  format: FlowGraphFormat;
  includeVariables: boolean;
  includeFormulas: boolean;
  direction: FlowGraphDirection;
  layout: FlowGraphLayoutSelection;
  curve: FlowGraphCurve;
  elk: FlowGraphElkOptions;
  nodeSpacing: number;
  rankSpacing: number;
  legend: boolean;
  labelWidth: number;
  style: FlowGraphStyle;
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
  kind: 'default' | 'fault' | 'normal' | 'outcome';
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

export interface FlowTraversalResult {
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

export interface FlowDescribeResult extends FlowTraversalResult {
  sections: FlowDescribeSection[];
}

export interface FlowGraphResult extends FlowTraversalResult {
  format: FlowGraphFormat;
  includeVariables: boolean;
  includeFormulas: boolean;
  requestedDirection: FlowGraphDirection;
  resolvedDirection: FlowGraphResolvedDirection;
  requestedLayout: FlowGraphLayout;
  layoutCandidates: FlowGraphResolvedLayout[] | null;
  resolvedLayout: FlowGraphResolvedLayout | null;
  requestedCurve: FlowGraphCurve;
  resolvedCurve: FlowGraphResolvedCurve | null;
  requestedElk: FlowGraphElkOptions;
  resolvedElk: FlowGraphResolvedElkOptions | null;
  nodeSpacing: number;
  rankSpacing: number;
  legend: boolean;
  labelWidth: number;
  style: FlowGraphStyle;
  graph: string;
}
