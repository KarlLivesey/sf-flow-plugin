/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonVersionSelector } from './flow-analysis.js';
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';

export type FlowLintRule =
  | 'dml-inside-loop'
  | 'hard-coded-id'
  | 'inactive-subflow'
  | 'missing-fault-path'
  | 'missing-subflow'
  | 'unconnected-element'
  | 'unused-resource';

export type FlowLintSeverity = 'error' | 'warning';

export interface FlowLintLocation {
  file: string;
  startLine: number;
  startColumn: number;
  endLine: number | null;
  endColumn: number | null;
  primary: boolean;
}

export interface FlowLintRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
  rules: FlowLintRule[];
  excludedRules: FlowLintRule[];
}

export interface FlowLintFinding {
  fingerprint: string;
  rule: string;
  severity: FlowLintSeverity;
  message: string;
  element: string | null;
  path: string | null;
  analyzerSeverity?: number;
  tags?: string[];
  locations?: FlowLintLocation[];
}

export interface FlowLintResult {
  apiName: string;
  namespace: string | null;
  definitionId: string | null;
  requestedVersion: FlowComparisonVersionSelector | null;
  resolvedVersion: FlowVersionNumber | null;
  status: string;
  findings: FlowLintFinding[];
  newFindings: FlowLintFinding[];
  baselineFindings: FlowLintFinding[];
  errors: number;
  warnings: number;
  newErrors: number;
  newWarnings: number;
  targetOrg: string | null;
  sourceFile?: string;
}

export interface FlowLintDirectoryResult {
  sourceDirectory: string;
  flows: FlowLintResult[];
  findings: FlowLintFinding[];
  newFindings: FlowLintFinding[];
  baselineFindings: FlowLintFinding[];
  errors: number;
  warnings: number;
  newErrors: number;
  newWarnings: number;
}

export type FlowLintFailSeverity = 'error' | 'warning';

export type FlowLintResultFormat = 'human' | 'sarif';
