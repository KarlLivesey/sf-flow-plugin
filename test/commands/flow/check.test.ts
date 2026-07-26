/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowCheck from '../../../src/commands/flow/check.js';
import { FlowCheckService } from '../../../src/services/flow-check-service.js';
import type { FlowCheckResult } from '../../../src/types/flow-check.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';

const result: FlowCheckResult = {
  apiNames: ['Flow_A', 'Flow_B'],
  requestedVersion: 'latest',
  subflowVersion: 'active',
  checks: ['lint', 'metrics'],
  excludedChecks: [],
  recursive: true,
  maxDepth: 5,
  allowTruncated: false,
  flows: [],
  findings: [],
  errors: 0,
  warnings: 0,
  targetOrg: 'admin@example.com',
};

describe('flow check command', (): void => {
  it('is CI-safe by default', (): void => {
    expect(FlowCheck.flags['fail-on'].default).to.equal('error');
    expect(FlowCheck.flags['allow-truncated'].default).to.equal(false);
    expect(FlowCheck.flags['api-name'].multiple).to.equal(true);
  });

  it('passes repeatable names and selected checks to the service', async (): Promise<void> => {
    const flags = {
      'api-name': ['Flow_A', 'Flow_B'],
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 'latest' as const,
      only: ['lint', 'metrics'] as const,
      exclude: undefined,
      recursive: true,
      'subflow-version': 'active' as const,
      'max-depth': 5,
      'allow-truncated': false,
      'fail-on': 'error' as const,
      'result-format': 'human' as const,
      'output-file': undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowCheck.prototype, 'parseFlags').resolves({
      ...flags,
      only: [...flags.only],
    });
    const check = $$.SANDBOX.stub(FlowCheckService.prototype, 'check').resolves(result);
    const actual = await FlowCheck.run(['--json']);
    expect(check.firstCall.args[0]).to.deep.equal({
      apiNames: ['Flow_A', 'Flow_B'],
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      checks: ['lint', 'metrics'],
      excludedChecks: [],
      recursive: true,
      maxDepth: 5,
      allowTruncated: false,
    });
    expect(actual).to.equal(result);
  });
});

describe('flow check command qualified output', (): void => {
  it('qualifies Flow names in the interactive findings table', async (): Promise<void> => {
    const flags = {
      'api-name': ['Flow_A'],
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 'latest' as const,
      only: undefined,
      exclude: undefined,
      recursive: false,
      'subflow-version': 'active' as const,
      'max-depth': 5,
      'allow-truncated': false,
      'fail-on': 'error' as const,
      'result-format': 'human' as const,
      'output-file': undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    const finding = {
      apiName: 'Flow_A',
      namespace: 'managed',
      version: 1,
      check: 'versions' as const,
      code: 'no-active-version',
      severity: 'warning' as const,
      message: 'No Flow version is active.',
      path: null,
    };
    $$.SANDBOX.stub(FlowCheck.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowCheckService.prototype, 'check').resolves({
      ...result,
      findings: [finding],
      warnings: 1,
    });
    await FlowCheck.run([]);
    expect(commandUx.table.firstCall.args[0].data[0]?.apiName).to.equal('managed__Flow_A');
  });
});
