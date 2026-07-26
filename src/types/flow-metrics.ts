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
}

export interface FlowMetricCounts {
  executableElements: number;
  decisions: number;
  decisionOutcomes: number;
  loops: number;
  maximumLoopNesting: number;
  dmlElements: number;
  dmlInsideLoops: number;
  apexActions: number;
  subflows: number;
  maximumPathDepth: number;
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
