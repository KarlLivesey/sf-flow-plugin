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
import { renderFlowComparison } from '../../../src/utils/flow-comparison-renderer.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';

const result: FlowCompareResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  fromDefinitionId: '300000000000001',
  toDefinitionId: '300000000000001',
  requestedFrom: 'active',
  requestedTo: 'latest',
  scopes: [],
  ignoreOrder: false,
  ignorePaths: [],
  fromVersion: 1,
  toVersion: 2,
  changes: [{ kind: 'changed', path: '$.label', before: 'One', after: 'Two' }],
  added: 0,
  removed: 0,
  changed: 1,
  different: true,
  targetOrg: 'admin@example.com',
  fromOrg: 'admin@example.com',
  toOrg: 'admin@example.com',
  crossOrg: false,
};

describe('flow compare flags', (): void => {
  it('defaults to comparing active with latest', (): void => {
    expect(FlowCompare.flags.from.default).to.equal('active');
    expect(FlowCompare.flags.to.default).to.equal('latest');
  });

  it('rejects combining the single-org and cross-org flags', (): void => {
    expect(FlowCompare.flags['target-org'].exclusive).to.deep.equal(['from-org', 'to-org']);
    expect(FlowCompare.flags['from-org'].exclusive).to.deep.equal(['target-org']);
    expect(FlowCompare.flags['to-org'].exclusive).to.deep.equal(['target-org']);
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

describe('flow compare request execution', (): void => {
  it('passes selectors and namespace to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      'from-org': undefined,
      'to-org': undefined,
      from: 1 as const,
      to: 'latest' as const,
      'fail-on-difference': false,
      only: ['elements' as const, 'resources' as const],
      'ignore-order': true,
      'ignore-path': ['$.metadata.description'],
      format: 'summary' as const,
      'output-file': undefined,
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
      fromOrg: 'admin@example.com',
      toOrg: 'admin@example.com',
      scopes: ['elements', 'resources'],
      ignoreOrder: true,
      ignorePaths: ['$.metadata.description'],
    });
    expect(actual).to.equal(result);
  });
});

describe('flow compare interactive output', (): void => {
  it('prints the summary renderer for interactive output', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      'from-org': undefined,
      'to-org': undefined,
      from: 'active' as const,
      to: 'latest' as const,
      'fail-on-difference': false,
      only: undefined,
      'ignore-order': false,
      'ignore-path': undefined,
      format: 'summary' as const,
      'output-file': undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowCompare.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowComparisonService.prototype, 'compare').resolves(result);
    await FlowCompare.run([]);
    expect(commandUx.log.firstCall.args[0]).to.equal(renderFlowComparison(result, 'summary'));
  });
});

describe('flow compare exit status', (): void => {
  it('sets a failing process status when requested and versions differ', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      'from-org': undefined,
      'to-org': undefined,
      from: 'active' as const,
      to: 'latest' as const,
      'fail-on-difference': true,
      only: undefined,
      'ignore-order': false,
      'ignore-path': undefined,
      format: 'summary' as const,
      'output-file': undefined,
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

describe('flow compare cross-org execution', (): void => {
  it('passes separate authenticated orgs to a cross-org comparison', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      'from-org': createCommandOrg({} as Connection, 'developer@example.com'),
      'to-org': createCommandOrg({} as Connection, 'preprod@example.com'),
      from: 'latest' as const,
      to: 'active' as const,
      'fail-on-difference': false,
      only: undefined,
      'ignore-order': false,
      'ignore-path': undefined,
      format: 'summary' as const,
      'output-file': undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowCompare.prototype, 'parseFlags').resolves(flags);
    const compare = $$.SANDBOX.stub(FlowComparisonService.prototype, 'compare').resolves(result);
    await FlowCompare.run(['--json']);
    expect(compare.firstCall.args[0]).to.include({
      fromOrg: 'developer@example.com',
      toOrg: 'preprod@example.com',
      from: 'latest',
      to: 'active',
    });
  });
});
