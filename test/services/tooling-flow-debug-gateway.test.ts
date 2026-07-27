/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ToolingFlowDebugGateway } from '../../src/services/tooling-flow-debug-gateway.js';
import { ToolingFlowDebugLog } from '../../src/services/tooling-flow-debug-log.js';
import { ToolingFlowDebugTrace } from '../../src/services/tooling-flow-debug-trace.js';
import type { FlowDebugExecutionRequest } from '../../src/types/flow-debug.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

const trace = { debugLevelId: '7dl-temp', traceFlagId: '7tf-temp', restore: null };
const log = {
  log: {
    id: '07L000000000001',
    status: 'Success',
    operation: 'executeAnonymous',
    startTime: '2026-07-27T10:00:00.000Z',
    durationMilliseconds: 25,
    logLength: 1000,
  },
  rawLog: 'correlated raw log',
};

function request(): FlowDebugExecutionRequest {
  return {
    apiName: 'Calculate_Discount',
    namespace: null,
    input: { percentage: 10 },
    outputVariables: ['discount'],
    logLevel: 'detailed',
    waitMilliseconds: 60_000,
  };
}

function connection(): {
  connection: Connection;
  describe: sinon.SinonStub;
  executeAnonymous: sinon.SinonStub;
} {
  const describe = sinon.stub();
  const executeAnonymous = sinon
    .stub()
    .resolves({ compiled: true, success: true, line: -1, column: -1, compileProblem: null });
  return {
    connection: {
      identity: sinon.stub().resolves({
        id: 'https://login.salesforce.com/id/00D000000000001/005000000000001',
      }),
      tooling: { describe, executeAnonymous },
    } as unknown as Connection,
    describe,
    executeAnonymous,
  };
}

function stubLifecycle(): {
  close: sinon.SinonStub;
  find: sinon.SinonStub;
  open: sinon.SinonStub;
} {
  return {
    open: sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace),
    close: sinon.stub(ToolingFlowDebugTrace.prototype, 'close').resolves(),
    find: sinon.stub(ToolingFlowDebugLog.prototype, 'find').resolves(log),
  };
}

describe('ToolingFlowDebugGateway permissions', (): void => {
  it('checks rollback tracing permissions without executing Apex', async (): Promise<void> => {
    const fake = connection();
    fake.describe.onFirstCall().resolves({ createable: true, deletable: true, updateable: false });
    fake.describe.onSecondCall().resolves({ createable: true, deletable: true, updateable: true });
    await new ToolingFlowDebugGateway(fake.connection).assertDebugAvailable('Calculate_Discount');
    expect(fake.describe.calledTwice).to.equal(true);
    expect(fake.describe.firstCall.calledWithExactly('DebugLevel')).to.equal(true);
    expect(fake.describe.secondCall.calledWithExactly('TraceFlag')).to.equal(true);
    expect(fake.executeAnonymous.called).to.equal(false);
  });

  it('rejects incomplete rollback tracing permissions', async (): Promise<void> => {
    const fake = connection();
    fake.describe.onFirstCall().resolves({ createable: true, deletable: true, updateable: false });
    fake.describe.onSecondCall().resolves({ createable: true, deletable: true, updateable: false });
    await expectErrorName(
      new ToolingFlowDebugGateway(fake.connection).assertDebugAvailable('Calculate_Discount'),
      'FlowDebugPermissionDenied'
    );
  });
});

describe('ToolingFlowDebugGateway lifecycle', (): void => {
  it('executes marked Apex, retrieves the log and always closes tracing', async (): Promise<void> => {
    const fake = connection();
    const lifecycle = stubLifecycle();
    try {
      const result = await new ToolingFlowDebugGateway(fake.connection).execute(request());
      expect(result.rawLog).to.equal('correlated raw log');
      expect(fake.executeAnonymous.firstCall.args[0]).to.include('Database.rollback(sfFlowSavepoint)');
      expect(lifecycle.find.calledOnce).to.equal(true);
      expect(lifecycle.close.calledOnceWithExactly(trace)).to.equal(true);
      expect(lifecycle.open.calledOnce).to.equal(true);
    } finally {
      sinon.restore();
    }
  });

  it('restores tracing when Execute Anonymous fails', async (): Promise<void> => {
    const fake = connection();
    fake.executeAnonymous.rejects(new Error('transport failed'));
    sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace);
    const close = sinon.stub(ToolingFlowDebugTrace.prototype, 'close').resolves();
    sinon.stub(ToolingFlowDebugLog.prototype, 'find').resolves(log);
    try {
      await expectErrorName(new ToolingFlowDebugGateway(fake.connection).execute(request()), 'FlowDebugFailed');
      expect(close.calledOnceWithExactly(trace)).to.equal(true);
    } finally {
      sinon.restore();
    }
  });

  it('surfaces cleanup failure instead of claiming tracing was restored', async (): Promise<void> => {
    const fake = connection();
    sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace);
    sinon.stub(ToolingFlowDebugTrace.prototype, 'close').rejects(new Error('restore failed'));
    sinon.stub(ToolingFlowDebugLog.prototype, 'find').resolves(log);
    try {
      await expectErrorName(new ToolingFlowDebugGateway(fake.connection).execute(request()), 'FlowDebugCleanupFailed');
    } finally {
      sinon.restore();
    }
  });
});
