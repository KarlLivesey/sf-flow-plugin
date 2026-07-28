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
import { loadFlowSourceDirectory } from './flow-source-directory-service.js';
import type { SalesforceCodeAnalyzerFlowService } from './salesforce-code-analyzer-flow-service.js';

interface DirectoryAnalyzerRequest {
  sourceDirectory: string;
  rules: string[];
  excludedRules: string[];
  analyzer: SalesforceCodeAnalyzerFlowService;
  progress: FlowProgressReporter;
}

export async function lintSourceDirectory(request: DirectoryAnalyzerRequest): Promise<FlowLintDirectoryResult> {
  const { sourceDirectory, rules, excludedRules, analyzer, progress } = request;
  progress('loading-source', sourceDirectory);
  const directory = await loadFlowSourceDirectory(sourceDirectory);
  progress('running-code-analyzer', directory.directory);
  const findings = await analyzer.analyse({
    sourceFile: directory.directory,
    rules,
    excludedRules,
  });
  return lintFlowSourceDirectory(directory, findings, progress);
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
  const lintFindings = checks.includes('lint')
    ? (progress('running-code-analyzer', directory.directory),
      await analyzer.analyse({ sourceFile: directory.directory, rules: [], excludedRules: [] }))
    : [];
  return checkFlowSourceDirectory(
    directory,
    { checks, excluded: excludedChecks, lintFindings, recursive, maxDepth },
    progress
  );
}
