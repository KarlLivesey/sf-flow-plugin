/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import FlowDebug from '../../../src/commands/flow/debug.js';
import FlowRun from '../../../src/commands/flow/run.js';
import { FlowDebugService } from '../../../src/services/flow-debug-service.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';
import { rollbackRunResult, runFlags } from '../../helpers/flow-run-command-fixtures.js';

function debugFlags(): Omit<ReturnType<typeof runFlags>, 'rollback'> {
  const { rollback, ...flags } = runFlags();
  void rollback;
  return flags;
}

describe('flow debug command', (): void => {
  it('does not change the flow run rollback default', (): void => {
    expect(FlowRun.flags.rollback.default).to.equal(false);
    const rawLogFlag = FlowDebug.flags['raw-log-file'];
    if (rawLogFlag === undefined) {
      expect.fail('Expected flow debug to define --raw-log-file.');
    }
    expect(rawLogFlag.summary).not.to.include('--rollback');
    expect(FlowDebug.flags).not.to.have.property('rollback');
  });

  it('executes the shared rollback path without reparsing flow run flags', async (): Promise<void> => {
    const result = rollbackRunResult(true);
    const parse = $$.SANDBOX.stub(FlowDebug.prototype, 'parseFlags').resolves(debugFlags());
    const runParse = $$.SANDBOX.stub(FlowRun.prototype, 'parseFlags').rejects(new Error('must not reparse'));
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result,
      rawLog: 'correlated log',
    });

    const actual = await FlowDebug.run(['--json']);

    expect(parse.calledOnce).to.equal(true);
    expect(runParse.called).to.equal(false);
    expect(debug.calledOnce).to.equal(true);
    expect(actual).to.equal(result);
  });
});

describe('flow debug command result contract', (): void => {
  it('returns the dedicated single-invocation debug contract', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowDebug.prototype, 'parseFlags').resolves(debugFlags());
    $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackRunResult(true),
      rawLog: 'correlated log',
    });

    const actual = await FlowDebug.run(['--json']);

    expect(actual.debug).not.to.equal(undefined);
    expect(actual.invocations).to.have.length(1);
  });

  it('uses multiple input values expanded by flags-dir exactly once', async (): Promise<void> => {
    const flags = { ...debugFlags(), input: ['percentage=10', 'region=EMEA'] };
    const parse = $$.SANDBOX.stub(FlowDebug.prototype, 'parseFlags').resolves(flags);
    const debug = $$.SANDBOX.stub(FlowDebugService.prototype, 'debug').resolves({
      result: rollbackRunResult(true),
      rawLog: 'correlated log',
    });

    await FlowDebug.run(['--flags-dir', '/expanded-once', '--json']);

    expect(parse.calledOnce).to.equal(true);
    expect(debug.firstCall.args[0]).to.deep.include({ input: { percentage: '10', region: 'EMEA' } });
  });
});
