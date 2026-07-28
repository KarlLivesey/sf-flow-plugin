/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowCheckFailed, flowLintFailed } from '../errors/flow-errors.js';
import type { FlowCheckKind, FlowCheckResult } from '../types/flow-check.js';
import type {
  FlowDescribeResult,
  FlowDescribeSection,
  FlowGraphRenderRequest,
  FlowGraphResult,
} from '../types/flow-inspection.js';
import type { FlowLintRequest, FlowLintResult, FlowLintRule } from '../types/flow-lint.js';
import type { FlowSourceMetricsResult } from '../types/flow-metrics.js';
import type { FlowSource } from '../types/flow-source.js';
import { filterFlowDescriptionSections } from '../utils/flow-description-sections.js';
import { flowContracts, lintCheckFindings } from '../utils/flow-check-analysis.js';
import { analyseFlowLintMetadata } from '../utils/flow-lint-analysis.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../utils/flow-metrics-analysis.js';
import { type FlowProgressReporter, noFlowProgress } from '../utils/flow-progress.js';
import { renderDescribedFlowGraph } from './flow-graph-service.js';

export const FLOW_SOURCE_LINT_RULES: FlowLintRule[] = [
  'dml-inside-loop',
  'hard-coded-id',
  'missing-fault-path',
  'unconnected-element',
  'unused-resource',
];

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

function selectedSourceLintRules(rules: FlowLintRule[], excludedRules: FlowLintRule[]): FlowLintRule[] {
  const unsupported = rules.filter((rule) => !FLOW_SOURCE_LINT_RULES.includes(rule));
  if (unsupported.length > 0) {
    throw flowLintFailed(
      `Local Flow source cannot run org-dependent lint rule${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(
        ', '
      )}.`
    );
  }
  const selected = new Set(rules.length === 0 ? FLOW_SOURCE_LINT_RULES : rules);
  excludedRules.forEach((rule) => selected.delete(rule));
  return FLOW_SOURCE_LINT_RULES.filter((rule) => selected.has(rule));
}

export function lintFlowSource(
  source: FlowSource,
  request: Pick<FlowLintRequest, 'rules' | 'excludedRules'>,
  progress: FlowProgressReporter = noFlowProgress
): FlowLintResult {
  const selectedRules = selectedSourceLintRules(request.rules, request.excludedRules);
  progress('analysing-results', `${source.apiName} (local source)`);
  const findings = analyseFlowLintMetadata(source.metadata, source.description).filter((finding) =>
    selectedRules.includes(finding.rule)
  );
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

function selectedSourceChecks(requested: FlowCheckKind[], excluded: FlowCheckKind[]): FlowCheckKind[] {
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
  selection: { requested: FlowCheckKind[]; excluded: FlowCheckKind[] },
  progress: FlowProgressReporter = noFlowProgress
): FlowCheckResult {
  const checks = selectedSourceChecks(selection.requested, selection.excluded);
  const lint = checks.includes('lint')
    ? lintFlowSource(source, { rules: FLOW_SOURCE_LINT_RULES, excludedRules: [] }, progress)
    : null;
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
