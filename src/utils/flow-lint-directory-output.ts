/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowLintDirectoryResult, FlowLintResult, FlowLintResultFormat } from '../types/flow-lint.js';
import {
  formatFlowLintDirectoryHuman,
  formatFlowLintDirectorySarif,
  formatFlowLintHuman,
  formatFlowLintSarif,
} from './flow-lint-output.js';

export type LintCommandResult = FlowLintDirectoryResult | FlowLintResult;

export function isFlowLintDirectoryResult(result: LintCommandResult): result is FlowLintDirectoryResult {
  return 'sourceDirectory' in result;
}

export function flowLintOutputContent(result: LintCommandResult, format: FlowLintResultFormat): string {
  if (format === 'sarif') {
    return isFlowLintDirectoryResult(result) ? formatFlowLintDirectorySarif(result) : formatFlowLintSarif(result);
  }
  return isFlowLintDirectoryResult(result) ? formatFlowLintDirectoryHuman(result) : formatFlowLintHuman(result);
}
