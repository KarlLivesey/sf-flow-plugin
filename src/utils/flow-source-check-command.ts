/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { SfCommand } from '@salesforce/sf-plugins-core';

import { selectedSourceChecks, selectedSourceDirectoryChecks } from '../services/flow-source-analysis-service.js';
import { SalesforceCodeAnalyzerFlowService } from '../services/salesforce-code-analyzer-flow-service.js';
import type { FlowCheckKind, FlowCheckResult, FlowCheckSeverity } from '../types/flow-check.js';
import { prepareSalesforceCodeAnalyzer } from './flow-code-analyzer-command.js';
import { selectedFlowChecks } from './flow-check-analysis.js';

interface SourceCheckFlags {
  sourceFile: string | undefined;
  sourceDirectory: string | undefined;
  only: FlowCheckKind[];
  exclude: FlowCheckKind[];
  noPrompt: boolean;
}

export function shouldFailFlowCheck(result: FlowCheckResult, severity: FlowCheckSeverity): boolean {
  return severity === 'warning' ? result.errors + result.warnings > 0 : result.errors > 0;
}

export interface PreparedSourceCheck {
  prepareAnalyzer: () => Promise<void>;
  analyzer: SalesforceCodeAnalyzerFlowService;
  checks: FlowCheckKind[] | null;
}

export async function prepareSourceCheck(
  command: Pick<SfCommand<unknown>, 'confirm' | 'jsonEnabled'>,
  flags: SourceCheckFlags
): Promise<PreparedSourceCheck> {
  const analyzer = new SalesforceCodeAnalyzerFlowService();
  const checks =
    flags.sourceDirectory !== undefined
      ? selectedSourceDirectoryChecks(flags.only, flags.exclude)
      : flags.sourceFile === undefined
      ? null
      : selectedSourceChecks(flags.only, flags.exclude);
  if (
    flags.sourceDirectory === undefined &&
    (checks ?? selectedFlowChecks(flags.only, flags.exclude)).includes('lint')
  ) {
    await prepareSalesforceCodeAnalyzer(command, analyzer, flags.noPrompt);
  }
  return {
    analyzer,
    checks,
    prepareAnalyzer: async () => prepareSalesforceCodeAnalyzer(command, analyzer, flags.noPrompt),
  };
}
