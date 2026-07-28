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
import { ToolingFlowBenchmarkLogCollector } from '../../src/services/tooling-flow-benchmark-log-collector.js';
import { ToolingFlowDebugTrace, type TraceState } from '../../src/services/tooling-flow-debug-trace.js';
import type { FlowBenchmarkSessionRequest } from '../../src/types/flow-benchmark.js';

const trace: TraceState = {
  debugLevelId: '7dl-temp',
  traceFlagId: '7tf-temp',
  restore: null,
  temporary: {
    debugLevelId: '7dl-temp',
    startDate: new Date(Date.now() - 60_000).toISOString(),
    expirationDate: new Date(Date.now() + 60 * 60_000).toISOString(),
  },
};

function request(): FlowBenchmarkSessionRequest {
  return {
    apiName: 'Calculate_Discount',
    namespace: null,
    input: { percentage: 10 },
    outputVariables: ['discount'],
    logLevel: 'detailed',
    waitMilliseconds: 120_000,
    traceDurationMilliseconds: 600_000,
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

function stubLifecycle(): { open: sinon.SinonStub; close: sinon.SinonStub; register: sinon.SinonStub } {
  return {
    open: sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace),
    close: sinon.stub(ToolingFlowDebugTrace.prototype, 'close').resolves(),
    register: sinon.stub(ToolingFlowBenchmarkLogCollector.prototype, 'register').callsFake(() => ({
      cancel: sinon.stub(),
      result: Promise.resolve({
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
    })),
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
  expect(lifecycle.open.firstCall.args[1]).to.include({ waitMilliseconds: 600_000 });
  expect(lifecycle.close.calledOnceWithExactly(trace)).to.equal(true);
  expect(fake.executeAnonymous.callCount).to.equal(2);
  expect(lifecycle.register.callCount).to.equal(2);
  expect(fake.executeAnonymous.firstCall.args[0]).to.include('Database.rollback(sfFlowSavepoint)');
}

function renewalTraces(): { expiring: TraceState; renewed: TraceState } {
  return {
    expiring: {
      ...trace,
      temporary: { ...trace.temporary, expirationDate: new Date(Date.now() + 60_000).toISOString() },
    },
    renewed: {
      ...trace,
      traceFlagId: '7tf-renewed',
      temporary: { ...trace.temporary, expirationDate: new Date(Date.now() + 60 * 60_000).toISOString() },
    },
  };
}

function collectorFixture(): {
  collector: ToolingFlowBenchmarkLogCollector;
  correlations: [string, string];
  query: sinon.SinonStub;
  records: Array<{ Id: string }>;
  requestBody: sinon.SinonStub;
} {
  const correlations: [string, string] = [
    '12345678-1234-1234-1234-123456789abc',
    '87654321-4321-4321-4321-cba987654321',
  ];
  const records = correlations.map((_, index) => ({
    Id: `07L00000000000${index + 1}`,
    Status: 'Success',
    Operation: 'executeAnonymous',
    StartTime: '2026-07-28T10:00:00.000Z',
    DurationMilliseconds: 25,
    LogLength: 1000,
  }));
  const query = sinon.stub().resolves({ records });
  const requestBody = sinon.stub().callsFake(async (url: string) => {
    const index = url.endsWith('1/Body') ? 0 : 1;
    return `SF_FLOW_PLUGIN_DEBUG|${correlations[index]}|END`;
  });
  const fake = {
    getApiVersion: (): string => '65.0',
    request: requestBody,
    tooling: { query },
  } as unknown as Connection;
  return {
    collector: new ToolingFlowBenchmarkLogCollector(fake, '005000000000001'),
    correlations,
    query,
    records,
    requestBody,
  };
}

function registerCollector(
  collector: ToolingFlowBenchmarkLogCollector,
  correlations: [string, string]
): Array<ReturnType<ToolingFlowBenchmarkLogCollector['register']>> {
  const startedAt = new Date('2026-07-28T09:59:00.000Z');
  return correlations.map((correlationId) =>
    collector.register({ apiName: 'Flow_A', correlationId, startedAt, waitMilliseconds: 5000 })
  );
}

async function expectTraceRenewal(context: {
  fake: ReturnType<typeof connection>;
  lifecycle: ReturnType<typeof stubLifecycle>;
  expiring: TraceState;
  renewed: TraceState;
}): Promise<void> {
  const session = await new ToolingFlowBenchmarkGateway(context.fake.connection).open(request());
  await session.prepareBatch();
  await session.close();
  expect(context.lifecycle.open.callCount).to.equal(2);
  expect(context.lifecycle.close.firstCall.calledWithExactly(context.expiring)).to.equal(true);
  expect(context.lifecycle.close.secondCall.calledWithExactly(context.renewed)).to.equal(true);
}

async function expectKnownLogFailureDuration(
  fake: ReturnType<typeof connection>,
  lifecycle: ReturnType<typeof stubLifecycle>
): Promise<void> {
  const session = await new ToolingFlowBenchmarkGateway(fake.connection).open(request());
  const error = await session.execute(request()).catch((caught: unknown) => caught);
  expect(error).to.have.property('name', 'FlowBenchmarkExecutionError');
  expect(error).to.have.property('errorCode', 'FlowDebugLogNotFound');
  expect(error).to.have.property('executionDurationMilliseconds').that.is.a('number');
  await session.close();
  expect(lifecycle.close.calledOnce).to.equal(true);
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

  it('renews an expiring trace between batches', async (): Promise<void> => {
    const fake = connection();
    const { expiring, renewed } = renewalTraces();
    const lifecycle = stubLifecycle();
    lifecycle.open.onFirstCall().resolves(expiring).onSecondCall().resolves(renewed);
    try {
      await expectTraceRenewal({ fake, lifecycle, expiring, renewed });
    } finally {
      sinon.restore();
    }
  });

  it('preserves Execute Anonymous duration when correlated log retrieval fails', async (): Promise<void> => {
    const fake = connection();
    const lifecycle = stubLifecycle();
    const logError = Object.assign(new Error('sensitive polling failure'), { name: 'FlowDebugLogNotFound' });
    lifecycle.register.onFirstCall().returns({ cancel: sinon.stub(), result: Promise.reject(logError) });
    try {
      await expectKnownLogFailureDuration(fake, lifecycle);
    } finally {
      sinon.restore();
    }
  });
});

describe('ToolingFlowBenchmarkLogCollector shared polling', (): void => {
  it('queries once and downloads each concurrent ApexLog body once', async (): Promise<void> => {
    const fixture = collectorFixture();
    const registrations = registerCollector(fixture.collector, fixture.correlations);
    expect((await Promise.all(registrations.map(({ result }) => result))).map((result) => result.log.id)).to.deep.equal(
      fixture.records.map((record) => record.Id)
    );
    expect(fixture.query.callCount).to.equal(1);
    expect(fixture.requestBody.callCount).to.equal(2);
    fixture.collector.close();
  });
});
