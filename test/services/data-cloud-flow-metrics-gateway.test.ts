/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { DataCloudFlowMetricsGateway } from '../../src/services/data-cloud-flow-metrics-gateway.js';
import {
  DataCloudConnectionDouble,
  dmoNotFound,
  legacyFlowRecord,
  legacyVersionRecord,
  page,
  standardFlowRecord,
  standardRunRecords,
  standardVersionRecord,
} from '../helpers/data-cloud-metrics-fixtures.js';

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

function expectStandardCapabilities(connection: DataCloudConnectionDouble): void {
  expect(connection.requests[0]).to.equal('/services/data/v65.0/ssot/data-model-objects/std__FlowDmo__dlm');
  expect(connection.requests[1]).to.equal('/services/data/v65.0/ssot/data-model-objects/std__FlowVersionDmo__dlm');
  expect(connection.requests[2]).to.equal('/services/data/v65.0/ssot/data-model-objects/std__FlowRunDmo__dlm');
  expect(connection.requests[6]).to.include({
    method: 'POST',
    url: '/services/data/v65.0/ssot/query-sql',
  });
}

function expectStandardSql(connection: DataCloudConnectionDouble): void {
  expect(connection.sqlQueries[0]).to.contain('FROM "std__FlowDmo__dlm"');
  expect(connection.sqlQueries[0]).to.contain(
    "\"std__DataSourceId__c\" IN ('Salesforce_Home', 'Salesforce_00D000000000001')"
  );
  expect(connection.sqlQueries[0]).to.contain('"std__DataSourceObjectId__c" = \'FlowRecord\'');
  expect(connection.sqlQueries[1]).to.contain('"std__VersionNumber__c" = 7');
  expect(connection.sqlQueries[1]).to.contain('"std__DataSourceObjectId__c" = \'FlowRecordVersion\'');
  expect(connection.sqlQueries[2]).to.contain('"std__InternalOrganizationId__c" = \'00D000000000001\'');
  expect(connection.sqlQueries[2]).to.match(
    /"std__ScheduledDateTime__c" >= timestamp with time zone '\d{4}-\d{2}-\d{2}T/u
  );
  expect(connection.sqlQueries[2]).to.contain('GROUP BY "std__FlowRunStatus__c", "std__ErrorReason__c"');
}

function expectStandardQueries(connection: DataCloudConnectionDouble): void {
  expectStandardCapabilities(connection);
  expectStandardSql(connection);
}

describe('DataCloudFlowMetricsGateway aggregation', (): void => {
  it('uses Connect SQL and aggregates runtime telemetry', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      {},
      {},
      {},
      {},
      {},
      {},
      page([standardFlowRecord()]),
      page([standardVersionRecord()]),
      page(standardRunRecords()),
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
    expectStandardQueries(connection);
  });
});

describe('DataCloudFlowMetricsGateway availability', (): void => {
  it('uses populated legacy DMOs when accessible standard DMOs lack the selected Flow', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      {},
      {},
      {},
      {},
      {},
      {},
      page([]),
      page([legacyFlowRecord()]),
      page([legacyVersionRecord()]),
      page([{ ['ssot__FlowRunStatus__c']: 'Complete', ['ssot__ErrorReason__c']: null, executions: '1' }]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest());
    expect(result.executions).to.equal(1);
    expect(connection.sqlQueries).to.have.length(4);
    expect(connection.sqlQueries[1]).to.contain('FROM "ssot__Flow__dlm"');
  });

  it('does not try a legacy schema for a malformed response', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([{}, {}, {}, {}, {}, {}, { records: [] }]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(7);
  });

  it('does not try a legacy schema for duplicate Flow records', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      {},
      {},
      {},
      {},
      {},
      {},
      page([standardFlowRecord(), standardFlowRecord()]),
    ]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(7);
  });
});

describe('DataCloudFlowMetricsGateway request validation', (): void => {
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
      dmoNotFound(),
      {},
      {},
      {},
      {},
      {},
      page([legacyFlowRecord()]),
      page([legacyVersionRecord()]),
      page([{ ['ssot__FlowRunStatus__c']: 'Complete', ['ssot__ErrorReason__c']: null, executions: '1' }]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest());
    expect(result.executions).to.equal(1);
    expect(result.averageDurationMilliseconds).to.equal(null);
    expect(connection.sqlQueries[0]).to.contain('FROM "ssot__Flow__dlm"');
  });
});

describe('DataCloudFlowMetricsGateway error aliases', (): void => {
  it('preserves a valid numeric status when an ordinary Error has a generic name', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      Object.assign(new Error('Not found'), { statusCode: 404 }),
      {},
      {},
      {},
      {},
      {},
      page([legacyFlowRecord()]),
      page([legacyVersionRecord()]),
      page([{ ['ssot__FlowRunStatus__c']: 'Complete', ['ssot__ErrorReason__c']: null, executions: '1' }]),
    ]);
    const result = await new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest());
    expect(result.executions).to.equal(1);
    expect(connection.sqlQueries[0]).to.contain('FROM "ssot__Flow__dlm"');
  });
});

describe('DataCloudFlowMetricsGateway capability failures', (): void => {
  it('does not treat permission failures as unavailable DMOs', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([Object.assign(new Error('Forbidden'), { statusCode: 403 })]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(1);
  });

  it('treats ambiguous DMO 404 responses as a failed capability check', async (): Promise<void> => {
    const connection = new DataCloudConnectionDouble([
      {},
      dmoNotFound(),
      {},
      dmoNotFound(),
      dmoNotFound(),
      dmoNotFound(),
    ]);
    await expectError(
      new DataCloudFlowMetricsGateway(connection.asConnection()).getMetrics(metricsRequest()),
      'FlowDataCloudMetricsFailed'
    );
    expect(connection.requests).to.have.length(6);
    expect(connection.sqlQueries).to.have.length(0);
  });
});
