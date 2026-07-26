/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowVersions from '../../../src/commands/flow/versions.js';
import { FlowVersionsService } from '../../../src/services/flow-versions-service.js';
import type { FlowVersionsResult } from '../../../src/types/flow.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowVersionsResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  activeVersion: 1,
  latestVersion: 2,
  versions: [],
  targetOrg: 'admin@example.com',
};

describe('flow versions command', (): void => {
  it('requires a Flow API name and uses the default target org resolver', (): void => {
    expect(FlowVersions.flags['api-name'].required).to.equal(true);
    expect(FlowVersions.flags['target-org'].required).to.equal(false);
    expect(FlowVersions.summary).to.contain('version');
  });

  it('passes the named Flow request to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      status: ['Draft' as const, 'InvalidDraft' as const],
      limit: 5,
      namespace: 'example',
      'api-version': '65.0',
    };
    $$.SANDBOX.stub(FlowVersions.prototype, 'parseFlags').resolves(flags);
    const getVersions = $$.SANDBOX.stub(FlowVersionsService.prototype, 'getVersions').resolves(result);
    const actual = await FlowVersions.run(['--json']);
    expect(getVersions.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      namespace: 'example',
      apiVersion: '65.0',
      statuses: ['Draft', 'InvalidDraft'],
      limit: 5,
    });
    expect(actual).to.equal(result);
  });
});
