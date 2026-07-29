/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ApexSoapExecuteAnonymous } from '../../src/services/apex-soap-execute-anonymous.js';
import { ApexSoapFlowBenchmarkGateway } from '../../src/services/apex-soap-flow-benchmark-gateway.js';
import { FlowBenchmarkExecutionError } from '../../src/utils/flow-benchmark-error.js';

const request = {
  apiName: 'Calculate_Discount',
  namespace: null,
  input: { percentage: 10 },
  outputVariables: ['discount'],
  logLevel: 'detailed' as const,
};

describe('ApexSoapFlowBenchmarkGateway success', (): void => {
  afterEach((): void => {
    sinon.restore();
  });

  it('uses the shared Apex SOAP executor and reports its complete request latency', async (): Promise<void> => {
    const execute = sinon.stub(ApexSoapExecuteAnonymous.prototype, 'execute').resolves({
      execution: { compiled: true, success: true, line: -1, column: -1 },
      rawLog: 'returned debug log',
      durationMilliseconds: 42.5,
    });

    const sample = await new ApexSoapFlowBenchmarkGateway({} as Connection).execute(request);

    expect(execute.calledOnce).to.equal(true);
    expect(execute.firstCall.args[0]).to.include({ logLevel: 'detailed' });
    expect(execute.firstCall.args[0]).not.to.have.property('timeoutMilliseconds');
    expect(sample).to.deep.include({ wallClockMilliseconds: 42.5 });
    expect(sample.transport.log).to.include({
      id: null,
      operation: 'executeAnonymous',
      durationMilliseconds: 42.5,
    });
    expect(sample.transport.rawLog).to.equal('returned debug log');
  });
});

describe('ApexSoapFlowBenchmarkGateway failures', (): void => {
  afterEach((): void => {
    sinon.restore();
  });

  it('does not retry an ambiguous SOAP failure', async (): Promise<void> => {
    const execute = sinon.stub(ApexSoapExecuteAnonymous.prototype, 'execute').rejects(new Error('socket timeout'));

    const error = await new ApexSoapFlowBenchmarkGateway({} as Connection)
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).to.be.instanceOf(FlowBenchmarkExecutionError);
    expect(error).to.include({ errorCode: 'FlowBenchmarkFailed' });
    expect((error as FlowBenchmarkExecutionError).executionDurationMilliseconds).to.be.a('number');
    expect(execute.calledOnce).to.equal(true);
  });

  it('preserves permission failures as a safe benchmark error code', async (): Promise<void> => {
    sinon
      .stub(ApexSoapExecuteAnonymous.prototype, 'execute')
      .rejects(Object.assign(new Error('INSUFFICIENT_ACCESS: denied'), { name: 'ERROR_HTTP_500' }));

    const error = await new ApexSoapFlowBenchmarkGateway({} as Connection)
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).to.include({ errorCode: 'FlowDebugPermissionDenied' });
  });
});
