/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowRun from '../../../src/commands/flow/run.js';
import { FlowDebugService } from '../../../src/services/flow-debug-service.js';
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
  durationMilliseconds: 25,
  successful: true,
  invocations: [
    {
      interviewId: 'interview-1',
      version: 1,
      success: true,
      inputs: { percentage: 10 },
      outputs: { discount: 10 },
      errors: [],
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
  'raw-log-file': undefined;
  'dry-run': boolean;
  rollback: boolean;
  confirm: boolean;
  'log-level': 'detailed' | undefined;
  'show-values': boolean | undefined;
  wait: number | undefined;
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
    'raw-log-file': undefined,
    'dry-run': false,
    rollback: false,
    confirm: false,
    'log-level': 'detailed',
    'show-values': false,
    wait: 2,
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
    expect(FlowRun.flags.rollback.default).to.equal(false);
    expect(FlowRun.flags.rollback.exclusive).to.equal(undefined);
    expect(FlowRun.flags['raw-log-file'].exclusive).to.deep.equal(['dry-run']);
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

describe('flow run rollback command', (): void => {
  it('runs exactly one input through the rollback and correlated-log service', async (): Promise<void> => {
    const commandFlags = {
      ...flags(),
      rollback: true,
      'log-level': undefined,
      'show-values': undefined,
      wait: undefined,
    };
    const debugResult: FlowRunResult = {
      ...result,
      debug: {
        correlationId: 'correlation-1',
        databaseChangesRolledBack: true,
        valuesShown: false,
        error: null,
        debugLog: {
          id: '07L000000000001',
          status: 'Success',
          operation: 'executeAnonymous',
          startTime: '2026-07-27T10:00:00.000Z',
          durationMilliseconds: 25,
          logLength: 1000,
        },
        events: [],
      },
    };
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(commandFlags);
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: debugResult,
      rawLog: 'correlated log',
    });
    const actual = await FlowRun.run(['--json']);
    expect(debug.firstCall.args[0]).to.deep.equal({
      apiName: 'Calculate_Discount',
      targetOrg: 'admin@example.com',
      input: { percentage: '10' },
      dryRun: false,
      confirm: false,
      logLevel: 'detailed',
      showValues: false,
      waitMilliseconds: 120_000,
    });
    expect(actual).to.equal(debugResult);
  });
});

describe('flow run rollback dry-run command', (): void => {
  it('accepts rollback with dry-run as a non-executing preflight', async (): Promise<void> => {
    const commandFlags = {
      ...flags(),
      'dry-run': true,
      rollback: true,
      'log-level': undefined,
      'show-values': undefined,
      wait: undefined,
    };
    const debugResult: FlowRunResult = {
      ...result,
      dryRun: true,
      successful: null,
      invocations: [
        {
          interviewId: null,
          version: 1,
          success: null,
          inputs: { percentage: 10 },
          outputs: {},
          errors: [],
          executed: false,
        },
      ],
      debug: {
        correlationId: null,
        databaseChangesRolledBack: null,
        valuesShown: false,
        error: null,
        debugLog: null,
        events: [],
      },
    };
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(commandFlags);
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: debugResult,
      rawLog: '',
    });
    const actual = await FlowRun.run(['--json']);
    expect(debug.firstCall.args[0]).to.include({
      apiName: 'Calculate_Discount',
      dryRun: true,
    });
    expect(actual).to.equal(debugResult);
  });
});

describe('flow run dry-run command', (): void => {
  it('does not set a failing status without a runtime outcome', async (): Promise<void> => {
    const commandFlags = { ...flags(), 'dry-run': true, 'fail-on-flow-error': true };
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(commandFlags);
    $$.SANDBOX.stub(FlowRunService.prototype, 'run').resolves({
      ...result,
      dryRun: true,
      successful: null,
      invocations: [
        {
          interviewId: null,
          version: 1,
          success: null,
          inputs: { percentage: 10 },
          outputs: {},
          errors: [],
          executed: false,
        },
      ],
    });
    try {
      await FlowRun.run(['--json']);
      expect(process.exitCode).to.equal(undefined);
    } finally {
      process.exitCode = undefined;
    }
  });
});
