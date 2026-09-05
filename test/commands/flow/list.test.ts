/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowList from '../../../src/commands/flow/list.js';
import { FlowListService } from '../../../src/services/flow-list-service.js';
import type { FlowListResult } from '../../../src/types/flow-list.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowListResult = {
  targetOrg: 'admin@example.com',
  filters: { apiNames: [], types: [], namespaces: [], statuses: [] },
  sort: 'api-name',
  order: 'asc',
  limit: null,
  definitions: [],
};

describe('flow list command', (): void => {
  it('uses the default target org resolver', (): void => {
    expect(FlowList.flags['target-org'].required).to.equal(false);
    expect(FlowList.summary).to.contain('List');
  });

  it('passes the authenticated username to the service', async (): Promise<void> => {
    const flags = {
      'target-org': createCommandOrg({} as Connection),
      'api-name': undefined,
      type: undefined,
      namespace: undefined,
      status: undefined,
      sort: 'api-name' as const,
      order: 'asc' as const,
      limit: undefined,
      'api-version': '65.0',
    };
    $$.SANDBOX.stub(FlowList.prototype, 'parseFlags').resolves(flags);
    const list = $$.SANDBOX.stub(FlowListService.prototype, 'list').resolves(result);
    const actual = await FlowList.run(['--json']);
    expect(list.firstCall.args[0]).to.deep.equal({
      targetOrg: 'admin@example.com',
      apiNames: [],
      types: [],
      namespaces: [],
      statuses: [],
      sort: 'api-name',
      order: 'asc',
    });
    expect(list.firstCall.args[1]).to.be.a('function');
    expect(actual).to.equal(result);
  });
});
