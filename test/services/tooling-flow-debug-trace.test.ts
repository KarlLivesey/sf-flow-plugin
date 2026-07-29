/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ToolingFlowDebugTrace } from '../../src/services/tooling-flow-debug-trace.js';
import type { FlowDebugExecutionRequest } from '../../src/types/flow-debug.js';

interface TraceConnection {
  connection: Connection;
  create: sinon.SinonStub;
  destroy: sinon.SinonStub;
  query: sinon.SinonStub;
  update: sinon.SinonStub;
}

function request(): FlowDebugExecutionRequest {
  return {
    apiName: 'Calculate_Discount',
    namespace: null,
    input: {},
    outputVariables: [],
    logLevel: 'detailed',
    waitMilliseconds: 60_000,
  };
}

function connection(records: unknown[]): TraceConnection {
  const create = sinon.stub();
  create.withArgs('DebugLevel').resolves({ success: true, id: '7dl-temp', errors: [] });
  create.withArgs('TraceFlag').resolves({ success: true, id: '7tf-temp', errors: [] });
  const destroy = sinon.stub().resolves({ success: true, id: 'deleted', errors: [] });
  const query = sinon.stub().resolves({ records });
  const update = sinon.stub().resolves({ success: true, id: 'updated', errors: [] });
  return {
    connection: { tooling: { create, destroy, query, update } } as unknown as Connection,
    create,
    destroy,
    query,
    update,
  };
}

describe('ToolingFlowDebugTrace new trace lifecycle', (): void => {
  it('creates and removes only its temporary trace records', async (): Promise<void> => {
    const fake = connection([]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const trace = await manager.open('005000000000001', request());
    expect(trace).to.deep.include({ debugLevelId: '7dl-temp', traceFlagId: '7tf-temp', restore: null });
    fake.query.onSecondCall().resolves({
      records: [
        {
          Id: trace.traceFlagId,
          DebugLevelId: trace.temporary.debugLevelId,
          StartDate: trace.temporary.startDate.replace('Z', '+00:00'),
          ExpirationDate: trace.temporary.expirationDate.replace('Z', '+00:00'),
        },
      ],
    });
    await manager.close(trace);
    expect(fake.create.firstCall.args[0]).to.equal('DebugLevel');
    expect(fake.create.secondCall.args[0]).to.equal('TraceFlag');
    expect(fake.destroy.firstCall.args).to.deep.equal(['TraceFlag', '7tf-temp']);
    expect(fake.destroy.secondCall.args).to.deep.equal(['DebugLevel', '7dl-temp']);
  });
});

describe('ToolingFlowDebugTrace existing trace lifecycle', (): void => {
  it('snapshots and restores the authenticated user trace flag', async (): Promise<void> => {
    const fake = connection([
      {
        Id: '7tf-existing',
        DebugLevelId: '7dl-existing',
        StartDate: '2026-07-27T09:00:00.000Z',
        ExpirationDate: '2026-07-27T12:00:00.000Z',
      },
    ]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const trace = await manager.open('005000000000001', request());
    expect(trace.restore).to.deep.equal({
      debugLevelId: '7dl-existing',
      startDate: '2026-07-27T09:00:00.000Z',
      expirationDate: '2026-07-27T12:00:00.000Z',
    });
    fake.query.onSecondCall().resolves({
      records: [
        {
          Id: trace.traceFlagId,
          DebugLevelId: trace.temporary.debugLevelId,
          StartDate: trace.temporary.startDate,
          ExpirationDate: trace.temporary.expirationDate,
        },
      ],
    });
    await manager.close(trace);
    expect(fake.update.secondCall.args[0]).to.equal('TraceFlag');
    expect(fake.update.secondCall.args[1]).to.deep.equal({
      Id: '7tf-existing',
      DebugLevelId: '7dl-existing',
      StartDate: '2026-07-27T09:00:00.000Z',
      ExpirationDate: '2026-07-27T12:00:00.000Z',
    });
    expect(fake.destroy.calledWith('TraceFlag', '7tf-existing')).to.equal(false);
    expect(fake.destroy.calledWith('DebugLevel', '7dl-temp')).to.equal(true);
  });
});

describe('ToolingFlowDebugTrace concurrency safety', (): void => {
  it('does not overwrite a concurrently changed trace flag', async (): Promise<void> => {
    const fake = connection([
      {
        Id: '7tf-existing',
        DebugLevelId: '7dl-existing',
        StartDate: '2026-07-27T09:00:00.000Z',
        ExpirationDate: '2026-07-27T12:00:00.000Z',
      },
    ]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const trace = await manager.open('005000000000001', request());
    fake.query.onSecondCall().resolves({
      records: [
        {
          Id: '7tf-existing',
          DebugLevelId: '7dl-other',
          StartDate: trace.temporary.startDate,
          ExpirationDate: trace.temporary.expirationDate,
        },
      ],
    });
    const error = await manager.close(trace).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugCleanupFailed');
    expect(fake.update.calledOnce).to.equal(true);
    expect(fake.destroy.called).to.equal(false);
  });

  it('selects only a trace flag that is active now', async (): Promise<void> => {
    const fake = connection([]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    await manager.open('005000000000001', request());
    expect(fake.query.firstCall.args[0]).to.include('AND StartDate <=');
    expect(fake.query.firstCall.args[0]).to.include('AND ExpirationDate >=');
  });
});

describe('ToolingFlowDebugTrace renewal', (): void => {
  it('renews the temporary flag in place while preserving the original restoration snapshot', async (): Promise<void> => {
    const fake = connection([
      {
        Id: '7tf-existing',
        DebugLevelId: '7dl-existing',
        StartDate: '2026-07-27T09:00:00.000Z',
        ExpirationDate: '2026-07-27T12:00:00.000Z',
      },
    ]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const trace = await manager.open('005000000000001', request());
    fake.query.onSecondCall().resolves({
      records: [
        {
          Id: trace.traceFlagId,
          DebugLevelId: trace.temporary.debugLevelId,
          StartDate: trace.temporary.startDate,
          ExpirationDate: trace.temporary.expirationDate,
        },
      ],
    });
    const renewed = await manager.renew(trace, request());
    expect(renewed).to.deep.include({ traceFlagId: trace.traceFlagId, restore: trace.restore });
    expect(renewed.temporary.expirationDate).not.to.equal(trace.restore?.expirationDate);
    fake.query.onThirdCall().resolves({
      records: [
        {
          Id: renewed.traceFlagId,
          DebugLevelId: renewed.temporary.debugLevelId,
          StartDate: renewed.temporary.startDate,
          ExpirationDate: renewed.temporary.expirationDate,
        },
      ],
    });
    await manager.close(renewed);
    expect(fake.update.lastCall.args[1]).to.include({ DebugLevelId: '7dl-existing' });
  });
});

describe('ToolingFlowDebugTrace renewal concurrency safety', (): void => {
  it('does not renew a concurrently changed trace flag', async (): Promise<void> => {
    const fake = connection([]);
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const trace = await manager.open('005000000000001', request());
    fake.query.onSecondCall().resolves({
      records: [
        {
          Id: trace.traceFlagId,
          DebugLevelId: '7dl-other',
          StartDate: trace.temporary.startDate,
          ExpirationDate: trace.temporary.expirationDate,
        },
      ],
    });
    const error = await manager.renew(trace, request()).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugCleanupFailed');
    expect(fake.update.called).to.equal(false);
  });
});

describe('ToolingFlowDebugTrace setup failure cleanup', (): void => {
  it('surfaces the temporary DebugLevel when orphan cleanup fails', async (): Promise<void> => {
    const fake = connection([]);
    fake.create.withArgs('TraceFlag').resolves({
      success: false,
      id: '',
      errors: [{ errorCode: 'UNKNOWN_EXCEPTION', message: 'redacted', fields: [] }],
    });
    fake.destroy.withArgs('DebugLevel', '7dl-temp').resolves({ success: false, id: '7dl-temp', errors: [] });
    const manager = new ToolingFlowDebugTrace(fake.connection);
    const error = await manager.open('005000000000001', request()).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugCleanupFailed');
    expect(error).to.have.property(
      'message',
      'Tracing setup failed and temporary DebugLevel "7dl-temp" could not be removed.'
    );
  });
});
