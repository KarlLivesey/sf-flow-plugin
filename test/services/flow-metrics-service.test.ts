/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowMetricsService } from '../../src/services/flow-metrics-service.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

describe('FlowMetricsService', (): void => {
  it('aggregates recursively selected Flow versions', async (): Promise<void> => {
    const result = await new FlowMetricsService(nestedFlowGateway()).calculate({
      apiName: 'Flow_A',
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      recursive: true,
      maxDepth: 10,
      dataCloud: false,
      dataCloudDays: 30,
    });
    expect(result.flows.map((flow) => flow.apiName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(result.totals.subflows).to.equal(1);
    expect(result.recursive).to.equal(true);
    expect(result.dataCloud).to.equal(null);
  });
});

describe('FlowMetricsService Data Cloud metrics', (): void => {
  it('loads Data Cloud metrics only when requested', async (): Promise<void> => {
    const runtime = {
      source: 'data-cloud' as const,
      enabled: true as const,
      apiName: 'Flow_A',
      namespace: null,
      version: 1,
      windowDays: 7,
      from: '2026-07-19T00:00:00.000Z',
      executions: 3,
      successfulExecutions: 3,
      failedExecutions: 0,
      averageDurationMilliseconds: 12,
      minimumDurationMilliseconds: 10,
      maximumDurationMilliseconds: 14,
      firstExecution: '2026-07-20T00:00:00.000Z',
      lastExecution: '2026-07-21T00:00:00.000Z',
      breakdowns: [],
    };
    const runtimeGateway = {
      getMetrics: async (): Promise<typeof runtime> => runtime,
    };
    const result = await new FlowMetricsService(nestedFlowGateway(), runtimeGateway).calculate({
      apiName: 'Flow_A',
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      recursive: false,
      maxDepth: 10,
      dataCloud: true,
      dataCloudDays: 7,
    });
    expect(result.dataCloud).to.equal(runtime);
  });
});
