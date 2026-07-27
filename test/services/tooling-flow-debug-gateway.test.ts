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

const trace = {
  debugLevelId: '7dl-temp',
  traceFlagId: '7tf-temp',
  restore: null,
  temporary: {
    debugLevelId: '7dl-temp',
    startDate: '2026-07-27T09:59:00.000Z',
    expirationDate: '2026-07-27T10:03:00.000Z',
  },
};
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
  query: sinon.SinonStub;
} {
  const describe = sinon.stub();
  const query = sinon.stub();
  const executeAnonymous = sinon
    .stub()
    .resolves({ compiled: true, success: true, line: -1, column: -1, compileProblem: null });
  return {
    connection: {
      identity: sinon.stub().resolves({
        id: 'https://login.salesforce.com/id/00D000000000001/005000000000001',
      }),
      query,
      tooling: { describe, executeAnonymous },
    } as unknown as Connection,
    describe,
    executeAnonymous,
    query,
  };
}

describe('ToolingFlowDebugGateway org safety', (): void => {
  it('reports only a validated transport status when the org query fails', async (): Promise<void> => {
    const fake = connection();
    fake.query.rejects(Object.assign(new Error('sensitive transport detail'), { errorCode: 'ERROR_HTTP_500' }));
    const error = await new ToolingFlowDebugGateway(fake.connection)
      .isProductionOrg()
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowQueryFailed');
    expect(error).to.have.property(
      'message',
      'Could not determine whether the target org is a production org. Status: ERROR_HTTP_500.'
    );
    expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
  });
});

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
    fake.describe.onThirdCall().resolves({ queryable: true, retrieveable: true });
    await new ToolingFlowDebugGateway(fake.connection).assertDebugAvailable('Calculate_Discount');
    expect(fake.describe.callCount).to.equal(3);
    expect(fake.describe.firstCall.calledWithExactly('DebugLevel')).to.equal(true);
    expect(fake.describe.secondCall.calledWithExactly('TraceFlag')).to.equal(true);
    expect(fake.describe.thirdCall.calledWithExactly('ApexLog')).to.equal(true);
    expect(fake.executeAnonymous.called).to.equal(false);
  });

  it('rejects incomplete rollback tracing permissions', async (): Promise<void> => {
    const fake = connection();
    fake.describe.onFirstCall().resolves({ createable: true, deletable: true, updateable: false });
    fake.describe.onSecondCall().resolves({ createable: true, deletable: true, updateable: false });
    fake.describe.onThirdCall().resolves({ queryable: true, retrieveable: true });
    await expectErrorName(
      new ToolingFlowDebugGateway(fake.connection).assertDebugAvailable('Calculate_Discount'),
      'FlowDebugPermissionDenied'
    );
  });

  it('rejects missing ApexLog query or retrieval access', async (): Promise<void> => {
    const fake = connection();
    fake.describe.onFirstCall().resolves({ createable: true, deletable: true, updateable: false });
    fake.describe.onSecondCall().resolves({ createable: true, deletable: true, updateable: true });
    fake.describe.onThirdCall().resolves({ queryable: true, retrieveable: false });
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

  it('uses the qualified Flow name throughout managed-Flow progress', async (): Promise<void> => {
    const fake = connection();
    stubLifecycle();
    const progress = sinon.stub();
    try {
      await new ToolingFlowDebugGateway(fake.connection).execute({ ...request(), namespace: 'managed' }, progress);
      expect(progress.firstCall.args[1]).to.equal('managed__Calculate_Discount (detailed)');
      expect(progress.secondCall.args[1]).to.equal('managed__Calculate_Discount (rollback)');
      expect(progress.thirdCall.args[1]).to.match(/^managed__Calculate_Discount \([0-9a-f-]+\)$/u);
      expect(progress.getCall(3).args[1]).to.equal('managed__Calculate_Discount');
    } finally {
      sinon.restore();
    }
  });
});

describe('ToolingFlowDebugGateway cleanup failures', (): void => {
  it('surfaces cleanup failure instead of claiming tracing was restored', async (): Promise<void> => {
    const fake = connection();
    sinon.stub(ToolingFlowDebugTrace.prototype, 'open').resolves(trace);
    sinon.stub(ToolingFlowDebugTrace.prototype, 'close').rejects(new Error('restore failed'));
    sinon.stub(ToolingFlowDebugLog.prototype, 'find').resolves(log);
    try {
      const error = await new ToolingFlowDebugGateway(fake.connection)
        .execute(request())
        .catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowDebugCleanupFailed');
      expect(error)
        .to.have.property('message')
        .that.includes('Temporary DebugLevel ID: 7dl-temp; TraceFlag ID: 7tf-temp. ApexLog ID: 07L000000000001.');
    } finally {
      sinon.restore();
    }
  });
});

describe('ToolingFlowDebugGateway progress failures', (): void => {
  it('restores tracing when the final progress update throws', async (): Promise<void> => {
    const fake = connection();
    const lifecycle = stubLifecycle();
    try {
      const progress = sinon.stub();
      progress.withArgs('restoring-trace').throws(new Error('terminal closed'));
      await expectErrorName(
        new ToolingFlowDebugGateway(fake.connection).execute(request(), progress),
        'FlowDebugFailed'
      );
      expect(lifecycle.close.calledOnceWithExactly(trace)).to.equal(true);
    } finally {
      sinon.restore();
    }
  });

  it('restores tracing when an in-flight progress update throws', async (): Promise<void> => {
    const fake = connection();
    const lifecycle = stubLifecycle();
    try {
      const progress = sinon.stub();
      progress.withArgs('executing-apex').throws(new Error('terminal closed'));
      await expectErrorName(
        new ToolingFlowDebugGateway(fake.connection).execute(request(), progress),
        'FlowDebugFailed'
      );
      expect(lifecycle.close.calledOnceWithExactly(trace)).to.equal(true);
    } finally {
      sinon.restore();
    }
  });
});
