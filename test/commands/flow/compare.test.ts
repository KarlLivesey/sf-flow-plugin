/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowCompare, { parseComparisonVersionSelector } from '../../../src/commands/flow/compare.js';
import { FlowComparisonService } from '../../../src/services/flow-comparison-service.js';
import type { FlowCompareResult } from '../../../src/types/flow-analysis.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowCompareResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  requestedFrom: 'active',
  requestedTo: 'latest',
  fromVersion: 1,
  toVersion: 2,
  changes: [{ kind: 'changed', path: '$.label', before: 'One', after: 'Two' }],
  added: 0,
  removed: 0,
  changed: 1,
  different: true,
  targetOrg: 'admin@example.com',
};

describe('flow compare flags', (): void => {
  it('defaults to comparing active with latest', (): void => {
    expect(FlowCompare.flags.from.default).to.equal('active');
    expect(FlowCompare.flags.to.default).to.equal('latest');
  });

  it('parses selectors', (): void => {
    expect(parseComparisonVersionSelector('active')).to.equal('active');
    expect(parseComparisonVersionSelector('latest')).to.equal('latest');
    expect(parseComparisonVersionSelector('7')).to.equal(7);
  });

  it('rejects invalid selectors', (): void => {
    expect(() => parseComparisonVersionSelector('0'))
      .to.throw()
      .with.property('name', 'FlowComparisonFailed');
  });
});

describe('flow compare command execution', (): void => {
  it('passes selectors and namespace to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      from: 1 as const,
      to: 'latest' as const,
      'fail-on-difference': false,
      namespace: 'example',
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowCompare.prototype, 'parseFlags').resolves(flags);
    const compare = $$.SANDBOX.stub(FlowComparisonService.prototype, 'compare').resolves(result);
    const actual = await FlowCompare.run(['--json']);
    expect(compare.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      namespace: 'example',
      from: 1,
      to: 'latest',
    });
    expect(actual).to.equal(result);
  });

  it('sets a failing process status when requested and versions differ', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      from: 'active' as const,
      to: 'latest' as const,
      'fail-on-difference': true,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowCompare.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowComparisonService.prototype, 'compare').resolves(result);
    try {
      await FlowCompare.run(['--json']);
      expect(process.exitCode).to.equal(1);
    } finally {
      process.exitCode = undefined;
    }
  });
});
