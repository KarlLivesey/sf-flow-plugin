/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowDeactivate from '../../../src/commands/flow/deactivate.js';
import { FlowDeactivationService } from '../../../src/services/flow-deactivation-service.js';
import type { FlowDeactivationResult } from '../../../src/types/flow.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowDeactivationResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  previousActiveVersion: 2,
  activeVersion: null,
  changed: false,
  dryRun: true,
  targetOrg: 'admin@example.com',
};

describe('flow deactivate command', (): void => {
  it('defaults dry-run to false and accepts the default target org', (): void => {
    expect(FlowDeactivate.flags['dry-run'].default).to.equal(false);
    expect(FlowDeactivate.flags['target-org'].required).to.equal(false);
  });

  it('passes dry-run to the deactivation service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      namespace: undefined,
      'api-version': undefined,
      'if-active-version': 2,
      'dry-run': true,
    };
    $$.SANDBOX.stub(FlowDeactivate.prototype, 'parseFlags').resolves(flags);
    const deactivate = $$.SANDBOX.stub(FlowDeactivationService.prototype, 'deactivate').resolves(result);
    const actual = await FlowDeactivate.run(['--json']);
    expect(deactivate.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      expectedActiveVersion: 2,
      dryRun: true,
    });
    expect(actual).to.equal(result);
  });
});
