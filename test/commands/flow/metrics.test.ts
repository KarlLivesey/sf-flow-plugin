/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowMetrics from '../../../src/commands/flow/metrics.js';
import { FlowMetricsService } from '../../../src/services/flow-metrics-service.js';
import type { FlowMetricsCommandResult } from '../../../src/types/flow-metrics.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const zeroCounts = {
  executableElements: 0,
  decisions: 0,
  decisionOutcomes: 0,
  loops: 0,
  maximumLoopNesting: 0,
  dmlElements: 0,
  dmlInsideLoops: 0,
  apexActions: 0,
  subflows: 0,
  maximumPathDepth: 0,
  faultCapableElements: 0,
  faultConnectedElements: 0,
  variables: 0,
  formulas: 0,
  unusedResources: 0,
  maximumFanIn: 0,
  maximumFanOut: 0,
  unreachableElements: 0,
};

const result: FlowMetricsCommandResult = {
  apiName: 'Flow_A',
  namespace: null,
  requestedVersion: 'latest',
  resolvedVersion: 1,
  subflowVersion: 'active',
  recursive: false,
  maxDepth: 10,
  totals: zeroCounts,
  referencedObjects: [],
  flows: [],
  dataCloud: null,
  warnings: [],
  targetOrg: 'admin@example.com',
};

describe('flow metrics command', (): void => {
  it('uses sensible traversal defaults', (): void => {
    expect(FlowMetrics.flags['flow-version'].default).to.equal('latest');
    expect(FlowMetrics.flags['subflow-version'].default).to.equal('active');
    expect(FlowMetrics.flags.recursive.default).to.equal(false);
    expect(FlowMetrics.flags['data-cloud'].default).to.equal(false);
    expect(FlowMetrics.flags['data-cloud-days'].default).to.equal(30);
  });

  it('passes the traversal selection to the metrics service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Flow_A',
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 'latest' as const,
      recursive: true,
      'subflow-version': 'active' as const,
      'max-depth': 4,
      'data-cloud': true,
      'data-cloud-days': 7,
      'output-file': undefined,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowMetrics.prototype, 'parseFlags').resolves(flags);
    const calculate = $$.SANDBOX.stub(FlowMetricsService.prototype, 'calculate').resolves(result);
    const actual = await FlowMetrics.run(['--json']);
    expect(calculate.firstCall.args[0]).to.deep.equal({
      apiName: 'Flow_A',
      targetOrg: 'admin@example.com',
      version: 'latest',
      recursive: true,
      subflowVersion: 'active',
      maxDepth: 4,
      dataCloud: true,
      dataCloudDays: 7,
    });
    expect(actual).to.equal(result);
  });
});
