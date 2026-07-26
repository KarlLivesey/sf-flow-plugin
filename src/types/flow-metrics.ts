/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonVersionSelector } from './flow-analysis.js';
import type { NamedFlowRequest } from './flow.js';
import type { FlowSubflowVersionSelector, FlowTraversalWarning } from './flow-inspection.js';

export interface FlowMetricsRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  recursive: boolean;
  maxDepth: number;
  dataCloud: boolean;
  dataCloudDays: number;
}

export interface FlowMetricCounts {
  executableElements: number;
  decisions: number;
  decisionOutcomes: number;
  loops: number;
  /** Upper bound derived after condensing each strongly connected component into one graph node. */
  maximumLoopNestingUpperBound: number;
  dmlElements: number;
  dmlInsideLoops: number;
  apexActions: number;
  subflows: number;
  /** Upper bound derived after condensing each strongly connected component into one graph node. */
  maximumPathDepthUpperBound: number;
  faultCapableElements: number;
  faultConnectedElements: number;
  variables: number;
  formulas: number;
  unusedResources: number;
  maximumFanIn: number;
  maximumFanOut: number;
  unreachableElements: number;
}

export interface FlowMetricEntry extends FlowMetricCounts {
  apiName: string;
  namespace: string | null;
  version: number;
  depth: number;
  faultPathCoverage: number | null;
  referencedObjects: string[];
  unusedResourceNames: string[];
  unreachableElementNames: string[];
}

export interface FlowRuntimeMetricBreakdown {
  status: string;
  errorReason: string | null;
  executions: number;
  averageDurationMilliseconds: number | null;
  minimumDurationMilliseconds: number | null;
  maximumDurationMilliseconds: number | null;
  firstExecution: string | null;
  lastExecution: string | null;
}

export interface FlowRuntimeMetrics {
  source: 'data-cloud';
  enabled: true;
  apiName: string;
  namespace: string | null;
  version: number;
  windowDays: number;
  from: string;
  executions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDurationMilliseconds: number | null;
  minimumDurationMilliseconds: number | null;
  maximumDurationMilliseconds: number | null;
  firstExecution: string | null;
  lastExecution: string | null;
  breakdowns: FlowRuntimeMetricBreakdown[];
}

export interface FlowRuntimeMetricsRequest {
  apiName: string;
  namespace: string | null;
  version: number;
  windowDays: number;
}

export interface FlowRuntimeMetricsGateway {
  getMetrics(request: FlowRuntimeMetricsRequest): Promise<FlowRuntimeMetrics>;
}

export interface FlowMetricsResult {
  apiName: string;
  namespace: string | null;
  requestedVersion: FlowComparisonVersionSelector;
  resolvedVersion: number;
  subflowVersion: FlowSubflowVersionSelector;
  recursive: boolean;
  maxDepth: number;
  totals: FlowMetricCounts;
  referencedObjects: string[];
  flows: FlowMetricEntry[];
  warnings: FlowTraversalWarning[];
  targetOrg: string;
}

export interface FlowMetricsCommandResult extends FlowMetricsResult {
  dataCloud: FlowRuntimeMetrics | null;
}
