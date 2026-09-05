/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowCheckKind, FlowCheckResult } from '../types/flow-check.js';
import type { FlowLintDirectoryResult } from '../types/flow-lint.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import { checkFlowSourceDirectory, lintFlowSourceDirectory } from './flow-source-analysis-service.js';
import { loadFlowSourceDirectory, verifyFlowSourceDirectory } from './flow-source-directory-service.js';
import type { SalesforceCodeAnalyzerFlowService } from './salesforce-code-analyzer-flow-service.js';
import { changedFlowSources } from './flow-changed-sources.js';

interface DirectoryAnalyzerRequest {
  prepareAnalyzer?: () => Promise<void>;
  changedSince?: string;
  includeCallers?: boolean;
  sourceDirectory: string;
  rules: string[];
  excludedRules: string[];
  analyzer: Pick<SalesforceCodeAnalyzerFlowService, 'analyse'>;
  progress: FlowProgressReporter;
}

async function prepareAnalysis(request: DirectoryAnalyzerRequest, count: number): Promise<void> {
  if (count === 0) {
    return;
  }
  await request.prepareAnalyzer?.();
  request.progress('running-code-analyzer', `${request.sourceDirectory} (${count} selected Flows)`);
}

export async function lintSourceDirectory(request: DirectoryAnalyzerRequest): Promise<FlowLintDirectoryResult> {
  const { sourceDirectory, rules, excludedRules, analyzer, progress } = request;
  progress('loading-source', sourceDirectory);
  const directory = await loadFlowSourceDirectory(sourceDirectory);
  const sources = await changedFlowSources(directory, request);
  await prepareAnalysis(request, sources.length);
  const findings =
    sources.length === 0
      ? []
      : await analyzer.analyse({
          sourceFile: directory.directory,
          targets: sources.map((source) => source.sourceFile),
          rules,
          excludedRules,
        });
  await verifyFlowSourceDirectory(directory);
  return lintFlowSourceDirectory({ ...directory, sources }, findings, progress);
}

interface DirectoryCheckRequest extends DirectoryAnalyzerRequest {
  checks: FlowCheckKind[];
  excludedChecks: FlowCheckKind[];
  recursive: boolean;
  maxDepth: number;
}

export async function checkSourceDirectory(request: DirectoryCheckRequest): Promise<FlowCheckResult> {
  const { sourceDirectory, checks, excludedChecks, recursive, maxDepth, analyzer, progress } = request;
  progress('loading-source', sourceDirectory);
  const directory = await loadFlowSourceDirectory(sourceDirectory);
  const roots = await changedFlowSources(directory, request);
  await prepareAnalysis(request, checks.includes('lint') ? roots.length : 0);
  const lintFindings =
    checks.includes('lint') && roots.length > 0
      ? await analyzer.analyse({
          sourceFile: directory.directory,
          targets: roots.map((source) => source.sourceFile),
          rules: [],
          excludedRules: [],
        })
      : [];
  await verifyFlowSourceDirectory(directory);
  return checkFlowSourceDirectory(
    directory,
    { checks, excluded: excludedChecks, lintFindings, recursive, maxDepth, roots },
    progress
  );
}
