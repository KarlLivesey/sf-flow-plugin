/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ApexSoapFlowDebugGateway } from '../../src/services/apex-soap-flow-debug-gateway.js';
import type { FlowDebugExecutionRequest } from '../../src/types/flow-debug.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

const rawLog = '10:00:00.0|USER_DEBUG|SF_FLOW_PLUGIN_DEBUG|correlation|ROLLBACK';
const soapResponse = {
  'soapenv:Envelope': {
    'soapenv:Header': { DebuggingInfo: { debugLog: rawLog } },
    'soapenv:Body': {
      executeAnonymousResponse: {
        result: { compiled: 'true', success: 'true', line: '-1', column: '-1' },
      },
    },
  },
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
  query: sinon.SinonStub;
  request: sinon.SinonStub;
  refreshAuth: sinon.SinonStub;
} {
  const query = sinon.stub();
  const soapRequest = sinon.stub().resolves(soapResponse);
  const refreshAuth = sinon.stub().resolves();
  return {
    connection: {
      accessToken: '00D000000000001!token',
      instanceUrl: 'https://example.my.salesforce.com',
      getApiVersion: (): string => '66.0',
      getAuthInfoFields: (): { orgId: string } => ({ orgId: '00D000000000001' }),
      query,
      request: soapRequest,
      refreshAuth,
    } as unknown as Connection,
    query,
    request: soapRequest,
    refreshAuth,
  };
}

describe('ApexSoapFlowDebugGateway org safety', (): void => {
  it('reports only a validated transport status when the org query fails', async (): Promise<void> => {
    const fake = connection();
    fake.query.rejects(Object.assign(new Error('sensitive transport detail'), { errorCode: 'ERROR_HTTP_500' }));
    const error = await new ApexSoapFlowDebugGateway(fake.connection)
      .isProductionOrg()
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowQueryFailed');
    expect(error).to.have.property(
      'message',
      'Could not determine whether the target org is a production org. Status: ERROR_HTTP_500.'
    );
    expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
  });

  it('preflights SOAP authentication without creating tracing records or executing Apex', async (): Promise<void> => {
    const fake = connection();
    await new ApexSoapFlowDebugGateway(fake.connection).assertDebugAvailable('Calculate_Discount');
    expect(fake.request.called).to.equal(false);
  });
});

describe('ApexSoapFlowDebugGateway execution', (): void => {
  it('returns the request-scoped log without polling ApexLog', async (): Promise<void> => {
    const fake = connection();
    const result = await new ApexSoapFlowDebugGateway(fake.connection).execute(request());
    expect(result.rawLog).to.equal(rawLog);
    expect(result.log).to.include({ id: null, operation: 'executeAnonymous', status: 'Success' });
    const body = (fake.request.firstCall.args[0] as { body: string }).body;
    expect(body).to.include('Database.rollback(sfFlowSavepoint)');
    expect(body).to.include('<apex:category>Apex_code</apex:category>');
    expect(body).to.include('<apex:category>Db</apex:category>');
  });

  it('uses the qualified Flow name in both progress stages', async (): Promise<void> => {
    const fake = connection();
    const progress = sinon.stub();
    await new ApexSoapFlowDebugGateway(fake.connection).execute({ ...request(), namespace: 'managed' }, progress);
    expect(progress.firstCall.args).to.deep.equal(['configuring-debug', 'managed__Calculate_Discount (detailed)']);
    expect(progress.secondCall.args).to.deep.equal(['executing-apex', 'managed__Calculate_Discount (rollback)']);
  });

  it('does not retry an ambiguous transport failure', async (): Promise<void> => {
    const fake = connection();
    fake.request.rejects(new Error('socket timeout'));
    await expectErrorName(new ApexSoapFlowDebugGateway(fake.connection).execute(request()), 'FlowDebugFailed');
    expect(fake.request.calledOnce).to.equal(true);
    expect(fake.refreshAuth.called).to.equal(false);
  });
});

describe('ApexSoapFlowDebugGateway permission failures', (): void => {
  it('maps SOAP permission faults reported inside an HTTP 500 message', async (): Promise<void> => {
    const fake = connection();
    fake.request.rejects(
      Object.assign(new Error('INSUFFICIENT_ACCESS: insufficient access rights on cross-reference id'), {
        name: 'ERROR_HTTP_500',
      })
    );
    const error = await new ApexSoapFlowDebugGateway(fake.connection)
      .execute(request())
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugPermissionDenied');
    expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
    expect(error).to.have.property('message').that.does.not.include('insufficient access rights');
    expect(fake.request.calledOnce).to.equal(true);
    expect(fake.refreshAuth.called).to.equal(false);
  });

  it('does not retain a permission fault returned by an invalid-session retry', async (): Promise<void> => {
    const fake = connection();
    fake.request.onFirstCall().rejects(Object.assign(new Error('INVALID_SESSION_ID'), { name: 'ERROR_HTTP_500' }));
    fake.request
      .onSecondCall()
      .rejects(Object.assign(new Error('INSUFFICIENT_ACCESS: sensitive retry detail'), { name: 'ERROR_HTTP_500' }));

    const error = await new ApexSoapFlowDebugGateway(fake.connection)
      .execute(request())
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugPermissionDenied');
    expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
    expect(error).to.have.property('message').that.does.not.include('sensitive retry detail');
    expect(fake.request.calledTwice).to.equal(true);
    expect(fake.refreshAuth.calledOnce).to.equal(true);
  });
});
