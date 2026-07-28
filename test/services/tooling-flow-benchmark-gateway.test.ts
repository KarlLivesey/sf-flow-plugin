/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ToolingFlowBenchmarkGateway } from '../../src/services/tooling-flow-benchmark-gateway.js';
import { ToolingFlowDebugLog } from '../../src/services/tooling-flow-debug-log.js';
import { ToolingFlowDebugTrace, type TraceState } from '../../src/services/tooling-flow-debug-trace.js';
import type { FlowDebugExecutionRequest } from '../../src/types/flow-debug.js';

const trace: TraceState = {
  debugLevelId: '7dl-temp',
  traceFlagId: '7tf-temp',
  restore: null,
  temporary: {
    debugLevelId: '7dl-temp',
    startDate: '2026-07-28T09:59:00.000Z',
    expirationDate: '2026-07-29T09:59:00.000Z',
  },
};

function request(): FlowDebugExecutionRequest {
  return {
    apiName: 'Calculate_Discount',
    namespace: null,
    input: { percentage: 10 },
    outputVariables: ['discount'],
    logLevel: 'detailed',
    waitMilliseconds: 120_000,
  };
}

function connection(): { connection: Connection; executeAnonymous: sinon.SinonStub } {
  const executeAnonymous = sinon
    .stub()
    .resolves({ compiled: true, success: true, line: -1, column: -1, compileProblem: null });
  return {
    connection: {
      identity: sinon.stub().resolves({
        id: 'https://login.salesforce.com/id/00D000000000001/005000000000001',
      }),
      tooling: { executeAnonymous },
    } as unknown as Connection,
    executeAnonymous,
  };
}

function stubLifecycle(): { open: sinon.SinonStub; close: sinon.SinonStub; find: sinon.SinonStub } {
  return {
    open: sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace),
    close: sinon.stub(ToolingFlowDebugTrace.prototype, 'close').resolves(),
    find: sinon.stub(ToolingFlowDebugLog.prototype, 'find').resolves({
      log: {
        id: '07L000000000001',
        status: 'Success',
        operation: 'executeAnonymous',
        startTime: '2026-07-28T10:00:00.000Z',
        durationMilliseconds: 25,
        logLength: 1000,
      },
      rawLog: 'complete correlated log',
    }),
  };
}

async function runTwoSamples(connectionValue: Connection): Promise<void> {
  const session = await new ToolingFlowBenchmarkGateway(connectionValue).open(request());
  await Promise.all([session.execute(request()), session.execute(request())]);
  await session.close();
  await session.close();
}

function expectSessionReuse(lifecycle: ReturnType<typeof stubLifecycle>, fake: ReturnType<typeof connection>): void {
  expect(lifecycle.open.calledOnce).to.equal(true);
  expect(lifecycle.close.calledOnceWithExactly(trace)).to.equal(true);
  expect(fake.executeAnonymous.callCount).to.equal(2);
  expect(lifecycle.find.callCount).to.equal(2);
  expect(lifecycle.find.firstCall.args[0]).to.include({ queryLimit: 2000 });
  expect(fake.executeAnonymous.firstCall.args[0]).to.include('Database.rollback(sfFlowSavepoint)');
}

describe('ToolingFlowBenchmarkGateway tracing session', (): void => {
  it('reuses one temporary trace for every sample and restores it once', async (): Promise<void> => {
    const fake = connection();
    const lifecycle = stubLifecycle();
    try {
      await runTwoSamples(fake.connection);
      expectSessionReuse(lifecycle, fake);
    } finally {
      sinon.restore();
    }
  });
});
