/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import FlowDebug from '../../../src/commands/flow/debug.js';
import FlowRun from '../../../src/commands/flow/run.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';
import { rollbackRunResult } from '../../helpers/flow-run-command-fixtures.js';

describe('flow debug command', (): void => {
  it('does not change the flow run rollback default', (): void => {
    expect(FlowRun.flags.rollback.default).to.equal(false);
    expect(FlowDebug.flags['raw-log-file']?.summary ?? '').not.to.include('--rollback');
    expect(FlowDebug.flags).not.to.have.property('rollback');
  });

  it('delegates to flow run with rollback selected', async (): Promise<void> => {
    const result = rollbackRunResult(true);
    $$.SANDBOX.stub(FlowDebug.prototype, 'parseFlags').resolves();
    const run = $$.SANDBOX.stub(FlowRun.prototype, 'run').resolves(result);

    const actual = await FlowDebug.run(['--api-name', 'Calculate_Discount', '--json']);

    expect((run.firstCall.thisValue as FlowRun).argv).to.deep.equal([
      '--api-name',
      'Calculate_Discount',
      '--json',
      '--rollback',
    ]);
    expect(actual).to.equal(result);
  });
});
