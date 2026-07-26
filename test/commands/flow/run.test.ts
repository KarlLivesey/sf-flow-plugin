/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowRun from '../../../src/commands/flow/run.js';
import { FlowRunService } from '../../../src/services/flow-run-service.js';
import type { FlowRunResult } from '../../../src/types/flow-invocation.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowRunResult = {
  apiName: 'Calculate_Discount',
  namespace: null,
  definitionId: '300000000000001',
  version: 1,
  processType: 'AutoLaunchedFlow',
  production: false,
  dryRun: false,
  successful: true,
  invocations: [
    {
      interviewId: 'interview-1',
      version: 1,
      success: true,
      inputs: { percentage: 10 },
      outputs: { discount: 10 },
      errors: [],
      durationMilliseconds: 25,
      executed: true,
    },
  ],
  targetOrg: 'admin@example.com',
};

function flags(): {
  'api-name': string;
  'target-org': ReturnType<typeof createCommandOrg>;
  input: string[];
  'input-file': undefined;
  'output-file': undefined;
  'dry-run': boolean;
  confirm: boolean;
  'fail-on-flow-error': boolean;
  namespace: undefined;
  'api-version': undefined;
} {
  return {
    'api-name': 'Calculate_Discount',
    'target-org': createCommandOrg({} as Connection),
    input: ['percentage=10'],
    'input-file': undefined,
    'output-file': undefined,
    'dry-run': false,
    confirm: false,
    'fail-on-flow-error': false,
    namespace: undefined,
    'api-version': undefined,
  };
}

describe('flow run command', (): void => {
  it('defines safe input and production flags', (): void => {
    expect(FlowRun.flags['api-name'].required).to.equal(true);
    expect(FlowRun.flags.input.multiple).to.equal(true);
    expect(FlowRun.flags.input.exclusive).to.deep.equal(['input-file']);
    expect(FlowRun.flags['input-file'].exclusive).to.deep.equal(['input']);
    expect(FlowRun.flags['dry-run'].default).to.equal(false);
    expect(FlowRun.flags.confirm.default).to.equal(false);
  });

  it('passes parsed inputs and org context to the service', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(flags());
    const run = $$.SANDBOX.stub(FlowRunService.prototype, 'run').resolves(result);
    const actual = await FlowRun.run(['--json']);
    expect(run.firstCall.args[0]).to.deep.equal({
      apiName: 'Calculate_Discount',
      targetOrg: 'admin@example.com',
      invocations: [{ percentage: '10' }],
      dryRun: false,
      confirm: false,
    });
    expect(actual).to.equal(result);
  });

  it('sets a failing status when requested and Salesforce reports failure', async (): Promise<void> => {
    const commandFlags = { ...flags(), 'fail-on-flow-error': true };
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(commandFlags);
    $$.SANDBOX.stub(FlowRunService.prototype, 'run').resolves({ ...result, successful: false });
    try {
      await FlowRun.run(['--json']);
      expect(process.exitCode).to.equal(1);
    } finally {
      process.exitCode = undefined;
    }
  });
});
