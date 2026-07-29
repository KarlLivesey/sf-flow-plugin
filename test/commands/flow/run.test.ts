/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import FlowRun from '../../../src/commands/flow/run.js';
import { FlowDebugService } from '../../../src/services/flow-debug-service.js';
import { FlowRunService } from '../../../src/services/flow-run-service.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';
import {
  flowRunResult as result,
  rollbackDryRunResult,
  rollbackRunResult,
  runFlags as flags,
} from '../../helpers/flow-run-command-fixtures.js';

let temporaryDirectory: string | undefined;

afterEach(async (): Promise<void> => {
  process.exitCode = undefined;
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true });
    temporaryDirectory = undefined;
  }
});

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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
    expect(FlowRun.flags['raw-log-file'].exclusive).to.equal(undefined);
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
    const debugResult = rollbackRunResult(true);
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves(commandFlags);
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: debugResult,
      rawLog: 'correlated log',
    });
    const actual = await FlowRun.run([]);
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
    expect(commandUx.log.firstCall.args[0]).to.equal('Database rollback confirmed by the returned debug log.');
  });

  it('warns when the correlated log cannot confirm rollback', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves({ ...flags(), rollback: true });
    $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackRunResult(null),
      rawLog: 'correlated log',
    });
    await FlowRun.run([]);
    expect(commandUx.warn.lastCall.args[0]).to.include('inspect the raw log');
  });
});

describe('flow run rollback timeout', (): void => {
  it('accepts rollback waits above the former ten-minute plugin ceiling', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves({ ...flags(), rollback: true, wait: 11 });
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackRunResult(true),
      rawLog: 'correlated log',
    });

    await FlowRun.run(['--json']);

    expect(debug.firstCall.args[0]).to.include({ waitMilliseconds: 660_000 });
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
    const debugResult = rollbackDryRunResult();
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

  it('validates a raw-log destination without creating a dry-run log', async (): Promise<void> => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-run-'));
    const rawLogFile = join(temporaryDirectory, 'nested', 'debug.log');
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves({
      ...flags(),
      'dry-run': true,
      rollback: true,
      'raw-log-file': rawLogFile,
    });
    $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackDryRunResult(),
      rawLog: '',
    });
    await FlowRun.run(['--json']);
    expect(await fileExists(rawLogFile)).to.equal(false);
  });
});

describe('flow run rollback destination safety', (): void => {
  it('rejects an invalid raw-log destination before execution or partial output', async (): Promise<void> => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-run-'));
    const blockingFile = join(temporaryDirectory, 'not-a-directory');
    const outputFile = join(temporaryDirectory, 'result.json');
    await writeFile(blockingFile, 'existing', 'utf8');
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves({
      ...flags(),
      'output-file': outputFile,
      'raw-log-file': join(blockingFile, 'debug.log'),
      rollback: true,
    });
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackDryRunResult(),
      rawLog: '',
    });
    const error = await FlowRun.run(['--json']).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugFailed');
    expect(debug.called).to.equal(false);
    expect(await fileExists(outputFile)).to.equal(false);
  });

  it('rejects colliding structured and raw-log destinations before execution', async (): Promise<void> => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-run-'));
    const outputFile = join(temporaryDirectory, 'result.json');
    $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').resolves({
      ...flags(),
      'output-file': outputFile,
      'raw-log-file': outputFile,
      rollback: true,
    });
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackDryRunResult(),
      rawLog: '',
    });
    const error = await FlowRun.run(['--json']).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowInputInvalid');
    expect(debug.called).to.equal(false);
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
