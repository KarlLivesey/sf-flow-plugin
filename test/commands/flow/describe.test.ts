/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowDescribe, { parseInspectionVersionSelector } from '../../../src/commands/flow/describe.js';
import { FlowDescribeService } from '../../../src/services/flow-describe-service.js';
import type { FlowDescribeResult } from '../../../src/types/flow-inspection.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowDescribeResult = {
  apiName: 'Order_Processing',
  namespace: null,
  requestedVersion: 'latest',
  resolvedVersion: 2,
  recursive: true,
  maxDepth: 4,
  flows: [],
  warnings: [],
  targetOrg: 'admin@example.com',
};

describe('flow describe flags', (): void => {
  it('defaults to the latest version without recursion', (): void => {
    expect(FlowDescribe.flags.version.default).to.equal('latest');
    expect(FlowDescribe.flags.recursive.default).to.equal(false);
    expect(FlowDescribe.flags['max-depth'].default).to.equal(10);
  });

  it('parses and validates version selectors', (): void => {
    expect(parseInspectionVersionSelector('active')).to.equal('active');
    expect(parseInspectionVersionSelector('12')).to.equal(12);
    expect(() => parseInspectionVersionSelector('0'))
      .to.throw()
      .with.property('name', 'FlowInspectionFailed');
  });
});

describe('flow describe command execution', (): void => {
  it('passes recursive traversal options to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      version: 'active' as const,
      recursive: true,
      'max-depth': 4,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowDescribe.prototype, 'parseFlags').resolves(flags);
    const describe = $$.SANDBOX.stub(FlowDescribeService.prototype, 'describe').resolves(result);
    const actual = await FlowDescribe.run(['--json']);
    expect(describe.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      version: 'active',
      recursive: true,
      maxDepth: 4,
    });
    expect(actual).to.equal(result);
  });
});
