/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonVersionSelector } from './flow-analysis.js';
import type { FlowSubflowVersionSelector, FlowVariableSummary } from './flow-inspection.js';
import type { FlowMetricsResult } from './flow-metrics.js';

export type FlowCheckKind = 'dependencies' | 'lint' | 'metrics' | 'subflows' | 'versions';

export type FlowCheckSeverity = 'error' | 'warning';

export type FlowCheckResultFormat = 'human' | 'sarif';

export interface FlowCheckRequest {
  apiNames: string[];
  targetOrg: string;
  namespace?: string;
  apiVersion?: string;
  version: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  checks: FlowCheckKind[];
  excludedChecks: FlowCheckKind[];
  recursive: boolean;
  maxDepth: number;
  allowTruncated: boolean;
}

export interface FlowCheckFinding {
  apiName: string;
  namespace: string | null;
  version: number | null;
  check: FlowCheckKind;
  code: string;
  severity: FlowCheckSeverity;
  message: string;
  path: string | null;
}

export interface FlowInputOutputContract {
  apiName: string;
  namespace: string | null;
  version: number;
  inputs: FlowVariableSummary[];
  outputs: FlowVariableSummary[];
}

export interface FlowCheckEntry {
  apiName: string;
  namespace: string | null;
  resolvedVersion: number;
  checks: FlowCheckKind[];
  contracts: FlowInputOutputContract[];
  metrics: FlowMetricsResult | null;
  findings: FlowCheckFinding[];
  errors: number;
  warnings: number;
}

export interface FlowCheckResult {
  apiNames: string[];
  requestedVersion: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  checks: FlowCheckKind[];
  excludedChecks: FlowCheckKind[];
  recursive: boolean;
  maxDepth: number;
  allowTruncated: boolean;
  flows: FlowCheckEntry[];
  findings: FlowCheckFinding[];
  errors: number;
  warnings: number;
  targetOrg: string;
}
