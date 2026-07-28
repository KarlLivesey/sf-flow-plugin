/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowCheckFailed } from '../errors/flow-errors.js';
import type { FlowCheckKind, FlowCheckResult } from '../types/flow-check.js';
import type {
  FlowDescribeResult,
  FlowDescribeSection,
  FlowGraphRenderRequest,
  FlowGraphResult,
} from '../types/flow-inspection.js';
import type { FlowLintFinding, FlowLintResult } from '../types/flow-lint.js';
import type { FlowSourceMetricsResult } from '../types/flow-metrics.js';
import type { FlowSource } from '../types/flow-source.js';
import { filterFlowDescriptionSections } from '../utils/flow-description-sections.js';
import { flowContracts, lintCheckFindings } from '../utils/flow-check-analysis.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../utils/flow-metrics-analysis.js';
import { type FlowProgressReporter, noFlowProgress } from '../utils/flow-progress.js';
import { renderDescribedFlowGraph } from './flow-graph-service.js';

export const FLOW_SOURCE_CHECK_KINDS: FlowCheckKind[] = ['lint', 'metrics'];

function sourceTraversal(source: FlowSource): Omit<FlowDescribeResult, 'sections'> {
  return {
    apiName: source.apiName,
    namespace: source.namespace,
    requestedVersion: null,
    resolvedVersion: null,
    subflowVersion: 'active',
    recursive: false,
    maxDepth: 0,
    flows: [source.description],
    warnings: [],
    targetOrg: null,
    sourceFile: source.sourceFile,
  };
}

export function describeFlowSource(source: FlowSource, sections: FlowDescribeSection[]): FlowDescribeResult {
  return {
    ...sourceTraversal(source),
    sections,
    flows: [filterFlowDescriptionSections(source.description, sections)],
  };
}

export function lintFlowSource(
  source: FlowSource,
  findings: FlowLintFinding[],
  progress: FlowProgressReporter = noFlowProgress
): FlowLintResult {
  progress('analysing-results', `${source.apiName} (local source)`);
  return {
    apiName: source.apiName,
    namespace: source.namespace,
    definitionId: null,
    requestedVersion: null,
    resolvedVersion: null,
    status: source.description.status,
    findings,
    newFindings: findings,
    baselineFindings: [],
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    newErrors: findings.filter((finding) => finding.severity === 'error').length,
    newWarnings: findings.filter((finding) => finding.severity === 'warning').length,
    targetOrg: null,
    sourceFile: source.sourceFile,
  };
}

export function graphFlowSource(
  source: FlowSource,
  request: FlowGraphRenderRequest,
  progress: FlowProgressReporter = noFlowProgress
): FlowGraphResult {
  return renderDescribedFlowGraph(sourceTraversal(source), request, progress);
}

export function selectedSourceChecks(requested: FlowCheckKind[], excluded: FlowCheckKind[]): FlowCheckKind[] {
  const unsupported = requested.filter((check) => !FLOW_SOURCE_CHECK_KINDS.includes(check));
  if (unsupported.length > 0) {
    throw flowCheckFailed(
      `Local Flow source cannot run org-dependent check${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(
        ', '
      )}.`
    );
  }
  const selected = new Set(requested.length === 0 ? ['lint'] : requested);
  excluded.forEach((check) => selected.delete(check));
  const checks = FLOW_SOURCE_CHECK_KINDS.filter((check) => selected.has(check));
  if (checks.length === 0) {
    throw flowCheckFailed('At least one local-source check is required.');
  }
  return checks;
}

function sourceMetrics(source: FlowSource): FlowSourceMetricsResult {
  const analysed = analyseFlowMetrics(source.metadata, source.description);
  const entry = { ...analysed, version: null };
  return {
    apiName: source.apiName,
    namespace: source.namespace,
    requestedVersion: null,
    resolvedVersion: null,
    subflowVersion: 'active',
    recursive: false,
    maxDepth: 0,
    totals: totalFlowMetrics([entry]),
    referencedObjects: entry.referencedObjects,
    flows: [entry],
    warnings: [],
    targetOrg: null,
    sourceFile: source.sourceFile,
  };
}

export function checkFlowSource(
  source: FlowSource,
  selection: { checks: FlowCheckKind[]; excluded: FlowCheckKind[]; lintFindings: FlowLintFinding[] },
  progress: FlowProgressReporter = noFlowProgress
): FlowCheckResult {
  const checks = selection.checks;
  const lint = checks.includes('lint') ? lintFlowSource(source, selection.lintFindings, progress) : null;
  const findings = lint === null ? [] : lintCheckFindings(lint, 'lint');
  const metrics = checks.includes('metrics') ? sourceMetrics(source) : null;
  const flow = {
    apiName: source.apiName,
    namespace: source.namespace,
    resolvedVersion: null,
    checks,
    contracts: flowContracts([source.description]),
    metrics,
    findings,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
  };
  return {
    apiNames: [source.apiName],
    requestedVersion: null,
    subflowVersion: 'active',
    checks,
    excludedChecks: selection.excluded,
    recursive: false,
    maxDepth: 0,
    allowTruncated: false,
    flows: [flow],
    findings,
    errors: flow.errors,
    warnings: flow.warnings,
    targetOrg: null,
    sourceFile: source.sourceFile,
  };
}
