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
import type { FlowLintDirectoryResult, FlowLintFinding, FlowLintResult } from '../types/flow-lint.js';
import type { FlowSource } from '../types/flow-source.js';
import { filterFlowDescriptionSections } from '../utils/flow-description-sections.js';
import { flowContracts, lintCheckFindings } from '../utils/flow-check-analysis.js';
import { type FlowProgressReporter, noFlowProgress } from '../utils/flow-progress.js';
import { renderDescribedFlowGraph } from './flow-graph-service.js';
import type { FlowSourceDirectory } from './flow-source-directory-service.js';
import { inspectDirectLocalSubflows, traverseLocalSubflows } from './flow-source-directory-service.js';
import { calculateFlowSourceMetrics } from './flow-source-metrics.js';

export const FLOW_SOURCE_CHECK_KINDS: FlowCheckKind[] = ['lint', 'metrics'];
export const FLOW_SOURCE_DIRECTORY_CHECK_KINDS: FlowCheckKind[] = ['lint', 'subflows', 'metrics'];

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

function primaryFile(finding: FlowLintFinding): string | undefined {
  return finding.locations?.find((location) => location.primary)?.file;
}

export function lintFlowSourceDirectory(
  directory: FlowSourceDirectory,
  findings: FlowLintFinding[],
  progress: FlowProgressReporter = noFlowProgress
): FlowLintDirectoryResult {
  const flows = directory.sources.map((source) =>
    lintFlowSource(
      source,
      findings.filter((finding) => primaryFile(finding) === source.sourceFile),
      progress
    )
  );
  return {
    sourceDirectory: directory.directory,
    flows,
    findings: flows.flatMap((flow) => flow.findings),
    newFindings: flows.flatMap((flow) => flow.newFindings),
    baselineFindings: [],
    errors: flows.reduce((sum, flow) => sum + flow.errors, 0),
    warnings: flows.reduce((sum, flow) => sum + flow.warnings, 0),
    newErrors: flows.reduce((sum, flow) => sum + flow.newErrors, 0),
    newWarnings: flows.reduce((sum, flow) => sum + flow.newWarnings, 0),
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

export function selectedSourceDirectoryChecks(requested: FlowCheckKind[], excluded: FlowCheckKind[]): FlowCheckKind[] {
  const unsupported = requested.filter((check) => !FLOW_SOURCE_DIRECTORY_CHECK_KINDS.includes(check));
  if (unsupported.length > 0) {
    throw flowCheckFailed(`Local Flow directories cannot run org-dependent checks: ${unsupported.join(', ')}.`);
  }
  const selected = new Set<FlowCheckKind>(requested.length === 0 ? ['lint', 'subflows'] : requested);
  excluded.forEach((check) => selected.delete(check));
  const checks = FLOW_SOURCE_DIRECTORY_CHECK_KINDS.filter((check) => selected.has(check));
  if (checks.length === 0) {
    throw flowCheckFailed('At least one local-directory check is required.');
  }
  return checks;
}

export function checkFlowSource(
  source: FlowSource,
  selection: { checks: FlowCheckKind[]; excluded: FlowCheckKind[]; lintFindings: FlowLintFinding[] },
  progress: FlowProgressReporter = noFlowProgress
): FlowCheckResult {
  const checks = selection.checks;
  const lint = checks.includes('lint') ? lintFlowSource(source, selection.lintFindings, progress) : null;
  const findings = lint === null ? [] : lintCheckFindings(lint, 'lint');
  const metrics = checks.includes('metrics') ? calculateFlowSourceMetrics(source) : null;
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

function directorySubflowFindings(
  source: FlowSource,
  directory: FlowSourceDirectory,
  traversal: Pick<DirectoryCheckSelection, 'recursive' | 'maxDepth'>
): FlowCheckResult['findings'] {
  const warnings = traversal.recursive
    ? traverseLocalSubflows(source, directory.sources, traversal.maxDepth).warnings
    : inspectDirectLocalSubflows(source, directory.sources);
  return warnings.map((warning) => ({
    apiName: source.apiName,
    namespace: source.namespace,
    version: null,
    check: 'subflows',
    code: warning.kind,
    severity: 'error',
    message: `${warning.kind}: ${warning.path.join(' -> ')}`,
    path: warning.path.join(' -> '),
  }));
}

interface DirectoryCheckSelection {
  checks: FlowCheckKind[];
  excluded: FlowCheckKind[];
  lintFindings: FlowLintFinding[];
  recursive: boolean;
  maxDepth: number;
}

function directoryCheckEntry(
  source: FlowSource,
  context: {
    directory: FlowSourceDirectory;
    selection: DirectoryCheckSelection;
    progress: FlowProgressReporter;
  }
): FlowCheckResult['flows'][number] {
  const { directory, selection, progress } = context;
  const result = checkFlowSource(
    source,
    {
      checks: selection.checks,
      excluded: selection.excluded,
      lintFindings: selection.lintFindings.filter((finding) => primaryFile(finding) === source.sourceFile),
    },
    progress
  );
  const subflowFindings = selection.checks.includes('subflows')
    ? directorySubflowFindings(source, directory, selection)
    : [];
  const flow = result.flows[0];
  if (flow === undefined) {
    throw flowCheckFailed(`Local Flow check did not produce an entry for "${source.apiName}".`);
  }
  const traversal = selection.recursive
    ? traverseLocalSubflows(source, directory.sources, selection.maxDepth)
    : { sources: [source], warnings: inspectDirectLocalSubflows(source, directory.sources) };
  const findings = [...result.findings, ...subflowFindings];
  return {
    ...flow,
    contracts: flowContracts(traversal.sources.map((item) => item.description)),
    metrics: selection.checks.includes('metrics')
      ? calculateFlowSourceMetrics(source, {
          ...traversal,
          recursive: selection.recursive,
          maxDepth: selection.maxDepth,
        })
      : null,
    findings,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
  };
}

export function checkFlowSourceDirectory(
  directory: FlowSourceDirectory,
  selection: DirectoryCheckSelection,
  progress: FlowProgressReporter = noFlowProgress
): FlowCheckResult {
  const results = directory.sources.map((source) => directoryCheckEntry(source, { directory, selection, progress }));
  const findings = results.flatMap((flow) => flow.findings);
  return {
    apiNames: results.map((flow) => flow.apiName),
    requestedVersion: null,
    subflowVersion: 'active',
    checks: selection.checks,
    excludedChecks: selection.excluded,
    recursive: selection.recursive,
    maxDepth: selection.maxDepth,
    allowTruncated: false,
    flows: results,
    findings,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    targetOrg: null,
    sourceDirectory: directory.directory,
  };
}
