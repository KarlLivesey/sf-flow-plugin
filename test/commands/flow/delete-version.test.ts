/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowDeleteVersion from '../../../src/commands/flow/delete-version.js';
import { FlowDeleteVersionService } from '../../../src/services/flow-delete-version-service.js';
import type { FlowDeleteVersionResult } from '../../../src/types/flow-deletion.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowDeleteVersionResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  activeVersion: 2,
  latestVersion: 3,
  expectedActiveVersion: 2,
  expectedLatestVersion: 3,
  plan: {
    action: 'delete-version',
    versionId: '301000000000001',
    versionNumber: 1,
    status: 'Obsolete',
    active: false,
    latest: false,
  },
  changed: false,
  dryRun: true,
  targetOrg: 'admin@example.com',
};

describe('flow delete-version command', (): void => {
  it('defaults to a dry run and requires an exact version', (): void => {
    expect(FlowDeleteVersion.flags['dry-run'].default).to.equal(true);
    expect(FlowDeleteVersion.flags['flow-version'].required).to.equal(true);
    expect(FlowDeleteVersion.flags['target-org'].required).to.equal(false);
  });

  it('passes the safety guards to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 1,
      'if-active-version': 2,
      'if-latest-version': 3,
      namespace: undefined,
      'api-version': undefined,
      'dry-run': true,
    };
    $$.SANDBOX.stub(FlowDeleteVersion.prototype, 'parseFlags').resolves(flags);
    const remove = $$.SANDBOX.stub(FlowDeleteVersionService.prototype, 'deleteVersion').resolves(result);
    const actual = await FlowDeleteVersion.run(['--json']);
    expect(remove.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      version: 1,
      expectedActiveVersion: 2,
      expectedLatestVersion: 3,
      dryRun: true,
    });
    expect(actual).to.equal(result);
  });
});
