/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import { DataCloudFlowMetricsGateway } from '../../src/services/data-cloud-flow-metrics-gateway.js';

interface QueryPage {
  records: unknown[];
}

class DataCloudConnectionDouble {
  public readonly queries: string[] = [];

  public constructor(private readonly responses: Array<QueryPage | Error>) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  public async query(soql: string): Promise<unknown> {
    this.queries.push(soql);
    const response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw new Error('Unexpected query.');
    }
    return response;
  }
}

function page(records: unknown[]): QueryPage {
  return { records };
}

function standardFlowRecord(): Record<string, unknown> {
  return { ['std__Id__c']: 'flow-1', ['std__NameInterfaceField__c']: 'Order_Flow' };
}

function standardVersionRecord(): Record<string, unknown> {
  return { ['std__Id__c']: 'version-7', ['std__VersionNumber__c']: 7 };
}

function legacyFlowRecord(): Record<string, unknown> {
  return { ['ssot__Id__c']: 'flow-1', ['ssot__Name__c']: 'Order_Flow' };
}

function legacyVersionRecord(): Record<string, unknown> {
  return { ['ssot__Id__c']: 'version-7', ['ssot__VersionNumber__c']: 7 };
}

async function expectError(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected ${name}.`);
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).name).to.equal(name);
  }
}

describe('DataCloudFlowMetricsGateway aggregation', (): void => {
  it('preflights Flow logging and aggregates runtime telemetry', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      page([standardFlowRecord()]),
      page([standardVersionRecord()]),
      page([
        {
          ['std__FlowRunStatus__c']: 'Complete',
          ['std__ErrorReason__c']: null,
          executions: 2,
          averageDurationMilliseconds: 12,
          minimumDurationMilliseconds: 10,
          maximumDurationMilliseconds: 14,
          firstExecution: '2026-07-20T10:00:00.000Z',
          lastExecution: '2026-07-21T10:00:00.000Z',
        },
        {
          ['std__FlowRunStatus__c']: 'Paused-Error',
          ['std__ErrorReason__c']: 'InternalError',
          executions: 1,
          averageDurationMilliseconds: 20,
          minimumDurationMilliseconds: 20,
          maximumDurationMilliseconds: 20,
          firstExecution: '2026-07-22T10:00:00.000Z',
          lastExecution: '2026-07-22T10:00:01.000Z',
        },
      ]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics({
      apiName: 'Order_Flow',
      namespace: null,
      version: 7,
      windowDays: 30,
    });
    expect(result).to.include({
      enabled: true,
      executions: 3,
      successfulExecutions: 2,
      failedExecutions: 1,
      minimumDurationMilliseconds: 10,
      maximumDurationMilliseconds: 20,
    });
    expect(result.averageDurationMilliseconds).to.be.closeTo(14.67, 0.01);
    expect(connection.queries[0]).to.contain('FROM std__FlowDmo__dlm');
    expect(connection.queries[1]).to.contain('std__VersionNumber__c = 7');
    expect(connection.queries[2]).to.contain('FROM std__FlowRunDmo__dlm');
  });
});

describe('DataCloudFlowMetricsGateway availability', (): void => {
  it('fails clearly when the Flow metrics DMOs do not contain the selected Flow', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([page([]), page([])]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics({
        apiName: 'Order_Flow',
        namespace: null,
        version: 7,
        windowDays: 30,
      }),
      'FlowDataCloudMetricsUnavailable'
    );
    expect(connection.queries).to.have.length(2);
  });

  it('rejects an invalid runtime metrics request before querying Data Cloud', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics({
        apiName: 'Order_Flow',
        namespace: null,
        version: 7,
        windowDays: 0,
      }),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.queries).to.have.length(0);
  });
});

describe('DataCloudFlowMetricsGateway compatibility', (): void => {
  it('falls back to the legacy Flow metrics DMO names', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      new Error('standard DMO unavailable'),
      page([legacyFlowRecord()]),
      page([legacyVersionRecord()]),
      page([{ ['ssot__FlowRunStatus__c']: 'Complete', ['ssot__ErrorReason__c']: null, executions: '1' }]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics({
      apiName: 'Order_Flow',
      namespace: null,
      version: 7,
      windowDays: 30,
    });
    expect(result.executions).to.equal(1);
    expect(result.averageDurationMilliseconds).to.equal(null);
    expect(connection.queries[1]).to.contain('FROM ssot__Flow__dlm');
  });
});
