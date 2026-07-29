/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { SfCommand } from '@salesforce/sf-plugins-core';

import { ensureSalesforceCodeAnalyzer } from '../services/salesforce-code-analyzer-flow-service.js';
import type { SalesforceCodeAnalyzerFlowService } from '../services/salesforce-code-analyzer-flow-service.js';

interface CodeAnalyzerCommand {
  confirm: SfCommand<unknown>['confirm'];
  jsonEnabled(): boolean;
}

export async function prepareSalesforceCodeAnalyzer(
  command: CodeAnalyzerCommand,
  service: SalesforceCodeAnalyzerFlowService,
  noPrompt: boolean
): Promise<void> {
  await ensureSalesforceCodeAnalyzer(service, {
    noPrompt,
    canPrompt: !command.jsonEnabled() && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY),
    confirm: async () =>
      command.confirm({
        message:
          'Salesforce Code Analyzer is required for local Flow linting. Install @salesforce/plugin-code-analyzer now',
        defaultAnswer: false,
      }),
  });
}
