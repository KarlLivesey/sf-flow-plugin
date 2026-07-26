/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import { z } from 'zod';

import { DataCloudFlowMetricsGateway } from '../../src/services/data-cloud-flow-metrics-gateway.js';

interface QueryResponse {
  data: unknown[][];
  metadata: Array<{ name: string }>;
  returnedRows: number;
  status: {
    completionStatus: string;
    queryId: string;
    rowCount: number;
  };
}

interface RequestDetails {
  method: string;
  url: string;
  body?: string;
}

const requestBodySchema = z.object({ sql: z.string() });

class DataCloudConnectionDouble {
  public readonly requests: Array<string | RequestDetails> = [];
  public readonly sqlQueries: string[] = [];
  public readonly version = '65.0';

  public constructor(private readonly responses: unknown[]) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  public async request(request: string | RequestDetails): Promise<unknown> {
    this.requests.push(request);
    if (typeof request !== 'string' && request.body !== undefined) {
      const body = requestBodySchema.parse(JSON.parse(request.body) as unknown);
      this.sqlQueries.push(body.sql);
    }
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

function page(records: Array<Record<string, unknown>>): QueryResponse {
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return {
    data: records.map((record) => names.map((name) => record[name])),
    metadata: names.map((name) => ({ name })),
    returnedRows: records.length,
    status: {
      completionStatus: 'ResultsProduced',
      queryId: 'query-1',
      rowCount: records.length,
    },
  };
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

function metricsRequest(): {
  apiName: string;
  namespace: null;
  version: number;
  windowDays: number;
} {
  return { apiName: 'Order_Flow', namespace: null, version: 7, windowDays: 30 };
}

describe('DataCloudFlowMetricsGateway aggregation', (): void => {
  it('uses Connect SQL and aggregates runtime telemetry', async (): Promise<void> => {
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
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest());
    expect(result).to.include({
      enabled: true,
      executions: 3,
      successfulExecutions: 2,
      failedExecutions: 1,
      minimumDurationMilliseconds: 10,
      maximumDurationMilliseconds: 20,
    });
    expect(result.averageDurationMilliseconds).to.be.closeTo(14.67, 0.01);
    expect(connection.requests[0]).to.include({
      method: 'POST',
      url: '/services/data/v65.0/ssot/query-sql',
    });
    expect(connection.sqlQueries[0]).to.contain('FROM std__FlowDmo__dlm');
    expect(connection.sqlQueries[1]).to.contain('std__VersionNumber__c = 7');
    expect(connection.sqlQueries[2]).to.match(/timestamp with time zone '\d{4}-\d{2}-\d{2}T/u);
  });
});

describe('DataCloudFlowMetricsGateway availability', (): void => {
  it('does not try a legacy schema when the standard DMO lacks the selected Flow', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([page([])]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsUnavailable'
    );
    expect(connection.sqlQueries).to.have.length(1);
  });

  it('does not try a legacy schema for a malformed response', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([{ records: [] }]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(1);
  });

  it('does not try a legacy schema for duplicate Flow records', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([page([standardFlowRecord(), standardFlowRecord()])]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(1);
  });

  it('rejects an invalid runtime metrics request before querying Data Cloud', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics({
        ...metricsRequest(),
        windowDays: 0,
      }),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(0);
  });
});

describe('DataCloudFlowMetricsGateway compatibility', (): void => {
  it('falls back only when the standard Flow metrics DMO is unavailable', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      new Error('Table std__FlowDmo__dlm was not found'),
      page([legacyFlowRecord()]),
      page([legacyVersionRecord()]),
      page([{ ['ssot__FlowRunStatus__c']: 'Complete', ['ssot__ErrorReason__c']: null, executions: '1' }]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest());
    expect(result.executions).to.equal(1);
    expect(result.averageDurationMilliseconds).to.equal(null);
    expect(connection.sqlQueries[1]).to.contain('FROM ssot__Flow__dlm');
  });
});
