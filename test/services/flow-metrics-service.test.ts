/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowMetricsService } from '../../src/services/flow-metrics-service.js';
import type { FlowRuntimeMetrics, FlowRuntimeMetricsRequest } from '../../src/types/flow-metrics.js';
import { FakeFlowGateway, flowVersion } from '../helpers/fake-flow-gateway.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

function runtimeMetrics(apiName = 'Flow_A', namespace: string | null = null): FlowRuntimeMetrics {
  return {
    source: 'data-cloud',
    enabled: true,
    apiName,
    namespace,
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
}

function managedFlowGateway(): FakeFlowGateway {
  const version = flowVersion('300000000000201', 1, 'Active');
  const gateway = new FakeFlowGateway(
    [
      {
        id: version.definitionId,
        apiName: 'Managed_Flow',
        namespace: 'example',
        activeVersionId: version.id,
        latestVersionId: version.id,
      },
    ],
    [version]
  );
  gateway.metadata.set(version.id, {});
  return gateway;
}

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
    const runtime = runtimeMetrics();
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

describe('FlowMetricsService Data Cloud identity', (): void => {
  it('uses the resolved namespace when a managed Flow is selected without one', async (): Promise<void> => {
    const requests: FlowRuntimeMetricsRequest[] = [];
    const runtimeGateway = {
      getMetrics: async (request: FlowRuntimeMetricsRequest): Promise<FlowRuntimeMetrics> => {
        requests.push(request);
        return runtimeMetrics('Managed_Flow', 'example');
      },
    };
    await new FlowMetricsService(managedFlowGateway(), runtimeGateway).calculate({
      apiName: 'Managed_Flow',
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      recursive: false,
      maxDepth: 10,
      dataCloud: true,
      dataCloudDays: 7,
    });
    expect(requests).to.deep.equal([{ apiName: 'Managed_Flow', namespace: 'example', version: 1, windowDays: 7 }]);
  });
});
