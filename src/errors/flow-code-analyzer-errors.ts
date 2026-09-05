/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SfError } from '@salesforce/core';

export function flowCodeAnalyzerUnavailable(): SfError {
  return SfError.create({
    name: 'FlowCodeAnalyzerUnavailable',
    message: 'Salesforce Code Analyzer is required to lint a local Flow source file.',
    actions: [
      'Install it with "sf plugins install @salesforce/plugin-code-analyzer", ensure any dependencies it requires are available, then run the command again.',
    ],
  });
}

export function flowCodeAnalyzerFailed(message: string): SfError {
  return SfError.create({
    name: 'FlowCodeAnalyzerFailed',
    message,
    actions: [
      'Confirm Salesforce Code Analyzer and any dependencies it requires are available, then run "sf code-analyzer run --rule-selector flow" directly for diagnostic output.',
    ],
  });
}
