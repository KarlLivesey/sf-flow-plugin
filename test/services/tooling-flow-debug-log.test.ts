/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ToolingFlowDebugLog } from '../../src/services/tooling-flow-debug-log.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

function record(id: string): Record<string, unknown> {
  return {
    Id: id,
    Status: 'Success',
    Operation: 'executeAnonymous',
    StartTime: '2026-07-27T10:00:00.000Z',
    DurationMilliseconds: 25,
    LogLength: 1000,
  };
}

function connection(): { connection: Connection; query: sinon.SinonStub; request: sinon.SinonStub } {
  const query = sinon.stub().resolves({ records: [record('07L-wrong'), record('07L-related')] });
  const request = sinon.stub();
  request.withArgs(sinon.match(/07L-wrong/u)).resolves('unrelated log');
  request.withArgs(sinon.match(/07L-related/u)).resolves('USER_DEBUG|SF_FLOW_PLUGIN_DEBUG|correlation-1|BEGIN');
  return {
    connection: {
      getApiVersion: (): string => '65.0',
      request,
      tooling: { query },
    } as unknown as Connection,
    query,
    request,
  };
}

describe('ToolingFlowDebugLog correlation', (): void => {
  it('returns the exact new ApexLog containing the unique marker', async (): Promise<void> => {
    const fake = connection();
    const result = await new ToolingFlowDebugLog(fake.connection).find({
      userId: '005000000000001',
      apiName: 'Calculate_Discount',
      correlationId: 'correlation-1',
      startedAt: new Date('2026-07-27T09:59:55.000Z'),
      waitMilliseconds: 1000,
    });
    expect(result.log.id).to.equal('07L-related');
    expect(result.rawLog).to.include('correlation-1');
    expect(fake.query.firstCall.args[0]).to.include("WHERE LogUserId = '005000000000001'");
    expect(fake.request.calledTwice).to.equal(true);
  });

  it('fails clearly when no correlated log is available', async (): Promise<void> => {
    const fake = connection();
    fake.request.resolves('unrelated log');
    await expectErrorName(
      new ToolingFlowDebugLog(fake.connection).find({
        userId: '005000000000001',
        apiName: 'Calculate_Discount',
        correlationId: 'missing',
        startedAt: new Date('2026-07-27T09:59:55.000Z'),
        waitMilliseconds: -1,
      }),
      'FlowDebugLogNotFound'
    );
  });

  it('maps Salesforce log access failures to the stable permission error', async (): Promise<void> => {
    const fake = connection();
    fake.query.rejects(Object.assign(new Error('redacted'), { errorCode: 'INSUFFICIENT_ACCESS' }));
    await expectErrorName(
      new ToolingFlowDebugLog(fake.connection).find({
        userId: '005000000000001',
        apiName: 'Calculate_Discount',
        correlationId: 'correlation-1',
        startedAt: new Date('2026-07-27T09:59:55.000Z'),
        waitMilliseconds: 1000,
      }),
      'FlowDebugPermissionDenied'
    );
  });
});
