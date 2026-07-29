/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { ApexSoapExecuteAnonymous, createApexSoapEnvelope } from '../../src/services/apex-soap-execute-anonymous.js';

function response(rawLog = 'returned log'): unknown {
  return {
    'env:Envelope': {
      'env:Header': { DebuggingInfo: { debugLog: rawLog } },
      'env:Body': {
        executeAnonymousResponse: {
          result: { compiled: 'true', success: 'false', line: '12', column: '3' },
        },
      },
    },
  };
}

function connection(request: sinon.SinonStub, refreshAuth = sinon.stub().resolves()): Connection {
  return {
    accessToken: '00D000000000001!token',
    instanceUrl: 'https://example.my.salesforce.com',
    getApiVersion: (): string => '66.0',
    getAuthInfoFields: (): { orgId: string } => ({ orgId: '00D000000000001' }),
    request,
    refreshAuth,
  } as unknown as Connection;
}

describe('ApexSoapExecuteAnonymous', (): void => {
  it('escapes Apex and maps every detailed log category into a request-scoped header', (): void => {
    const envelope = createApexSoapEnvelope('token<&', {
      apexSource: "System.debug('one < two & three');",
      logLevel: 'detailed',
    });
    expect(envelope).to.include('token&lt;&amp;');
    expect(envelope).to.include('one &lt; two &amp; three');
    expect(envelope).to.include('<apex:category>Apex_code</apex:category>');
    expect(envelope).to.include('<apex:category>Apex_profiling</apex:category>');
    expect(envelope).to.include('<apex:category>Db</apex:category>');
  });

  it('parses the execution result and inline DebuggingInfo log', async (): Promise<void> => {
    const request = sinon.stub().resolves(response());
    const result = await new ApexSoapExecuteAnonymous(connection(request)).execute({
      apexSource: 'System.debug(1);',
      logLevel: 'basic',
    });
    expect(result.execution).to.deep.equal({
      compiled: true,
      success: false,
      line: 12,
      column: 3,
      compileProblem: null,
      exceptionMessage: null,
      exceptionStackTrace: null,
    });
    expect(result.rawLog).to.equal('returned log');
    const httpRequest = request.firstCall.args[0] as { url: string };
    expect(httpRequest.url).to.equal('https://example.my.salesforce.com/services/Soap/s/66.0/00D000000000001');
  });
});

describe('ApexSoapExecuteAnonymous failure responses', (): void => {
  it('preserves nullable compile diagnostics when Salesforce omits the inline log', async (): Promise<void> => {
    const soapResponse = response();
    const envelope = soapResponse as {
      'env:Envelope': {
        'env:Header': object;
        'env:Body': { executeAnonymousResponse: { result: Record<string, string | null> } };
      };
    };
    envelope['env:Envelope']['env:Header'] = {};
    envelope['env:Envelope']['env:Body'].executeAnonymousResponse.result = {
      compiled: 'false',
      success: 'false',
      line: '2',
      column: '5',
      compileProblem: 'Unexpected token',
      exceptionMessage: null,
      exceptionStackTrace: null,
    };
    const result = await new ApexSoapExecuteAnonymous(connection(sinon.stub().resolves(soapResponse))).execute({
      apexSource: 'invalid Apex',
      logLevel: 'basic',
    });

    expect(result.execution).to.deep.include({
      compiled: false,
      success: false,
      compileProblem: 'Unexpected token',
      exceptionMessage: null,
    });
    expect(result.rawLog).to.equal('');
  });
});

describe('ApexSoapExecuteAnonymous authentication recovery', (): void => {
  it('refreshes and retries only a known pre-execution invalid-session rejection', async (): Promise<void> => {
    const request = sinon.stub();
    request.onFirstCall().rejects(Object.assign(new Error('INVALID_SESSION_ID'), { name: 'ERROR_HTTP_500' }));
    request.onSecondCall().resolves(response());
    const refreshAuth = sinon.stub().callsFake(async (): Promise<void> => {
      (fakeConnection as unknown as { accessToken: string }).accessToken = '00D000000000001!refreshed';
    });
    const fakeConnection = connection(request, refreshAuth);
    await new ApexSoapExecuteAnonymous(fakeConnection).execute({
      apexSource: 'System.debug(1);',
      logLevel: 'basic',
    });
    expect(refreshAuth.calledOnce).to.equal(true);
    expect(request.calledTwice).to.equal(true);
    const retried = request.secondCall.args[0] as { body: string };
    expect(retried.body).to.include('00D000000000001!refreshed');
  });
});
