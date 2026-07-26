/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowLint from '../../../src/commands/flow/lint.js';
import { FlowLintService } from '../../../src/services/flow-lint-service.js';
import type { FlowLintResult } from '../../../src/types/flow-lint.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowLintResult = {
  apiName: 'Root_Flow',
  namespace: null,
  definitionId: '300000000000001',
  requestedVersion: 'latest',
  resolvedVersion: 2,
  status: 'Draft',
  findings: [],
  newFindings: [],
  baselineFindings: [],
  errors: 0,
  warnings: 0,
  newErrors: 0,
  newWarnings: 0,
  targetOrg: 'admin@example.com',
};

describe('flow lint command', (): void => {
  it('defaults to linting the latest Flow version', (): void => {
    expect(FlowLint.flags['flow-version'].default).to.equal('latest');
    expect(FlowLint.flags['target-org'].required).to.equal(false);
  });

  it('passes the requested Flow to the lint service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Root_Flow',
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 'latest' as const,
      'fail-on': undefined,
      rule: undefined,
      'exclude-rule': undefined,
      'result-format': 'human' as const,
      'output-file': undefined,
      baseline: undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowLint.prototype, 'parseFlags').resolves(flags);
    const lint = $$.SANDBOX.stub(FlowLintService.prototype, 'lint').resolves(result);
    const actual = await FlowLint.run(['--json']);
    expect(lint.firstCall.args[0]).to.deep.equal({
      apiName: 'Root_Flow',
      targetOrg: 'admin@example.com',
      version: 'latest',
      rules: [],
      excludedRules: [],
    });
    expect(actual).to.equal(result);
  });
});
