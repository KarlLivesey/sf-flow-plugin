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

function invalidSessionError(): Error {
  return Object.assign(new Error('INVALID_SESSION_ID'), { name: 'ERROR_HTTP_500' });
}

function retryingRequest(): sinon.SinonStub {
  const request = sinon.stub();
  request.onFirstCall().rejects(invalidSessionError());
  request.onSecondCall().resolves(response());
  return request;
}

async function capturedFailure(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation;
    return undefined;
  } catch (error: unknown) {
    return error;
  }
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

describe('ApexSoapExecuteAnonymous empty response values', (): void => {
  it('normalises only empty SOAP records used for empty diagnostic elements', async (): Promise<void> => {
    const soapResponse = response({} as unknown as string);
    const resultFields = (
      soapResponse as {
        'env:Envelope': {
          'env:Body': { executeAnonymousResponse: { result: Record<string, unknown> } };
        };
      }
    )['env:Envelope']['env:Body'].executeAnonymousResponse.result;
    Object.assign(resultFields, {
      compileProblem: {},
      exceptionMessage: Object.create(null) as object,
      exceptionStackTrace: {},
    });

    const result = await new ApexSoapExecuteAnonymous(connection(sinon.stub().resolves(soapResponse))).execute({
      apexSource: 'System.debug(1);',
      logLevel: 'basic',
    });

    expect(result.execution).to.include({
      compileProblem: null,
      exceptionMessage: null,
      exceptionStackTrace: null,
    });
    expect(result.rawLog).to.equal('');
  });

  it('rejects arrays and non-empty records in SOAP diagnostic elements', async (): Promise<void> => {
    const failures = await Promise.all(
      [[], { value: 'Unexpected token' }].map(async (diagnostic): Promise<unknown> => {
        const soapResponse = response();
        (
          soapResponse as {
            'env:Envelope': {
              'env:Body': { executeAnonymousResponse: { result: Record<string, unknown> } };
            };
          }
        )['env:Envelope']['env:Body'].executeAnonymousResponse.result.compileProblem = diagnostic;
        const execute = new ApexSoapExecuteAnonymous(connection(sinon.stub().resolves(soapResponse))).execute({
          apexSource: 'invalid Apex',
          logLevel: 'basic',
        });
        return capturedFailure(execute);
      })
    );
    expect(failures.every((failure) => failure instanceof Error)).to.equal(true);
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
    request.onFirstCall().rejects(invalidSessionError());
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

describe('ApexSoapExecuteAnonymous authentication deadline', (): void => {
  it('shares one timeout and duration across the failed request, refresh and retry', async (): Promise<void> => {
    const clock = sinon.useFakeTimers();
    try {
      const request = retryingRequest();
      const refreshAuth = sinon.stub().callsFake(async (): Promise<void> => {
        clock.tick(600);
      });

      const result = await new ApexSoapExecuteAnonymous(connection(request, refreshAuth)).execute({
        apexSource: 'System.debug(1);',
        logLevel: 'basic',
        timeoutMilliseconds: 1000,
      });

      expect((request.firstCall.args[1] as { timeout: number }).timeout).to.equal(1000);
      expect((request.secondCall.args[1] as { timeout: number }).timeout).to.equal(400);
      expect(result.durationMilliseconds).to.equal(600);
    } finally {
      clock.restore();
    }
  });

  it('does not retry when authentication refresh exhausts the request deadline', async (): Promise<void> => {
    const clock = sinon.useFakeTimers();
    try {
      const request = sinon.stub().rejects(invalidSessionError());
      const refreshAuth = sinon.stub().callsFake(async (): Promise<void> => {
        clock.tick(1000);
      });
      const execute = new ApexSoapExecuteAnonymous(connection(request, refreshAuth)).execute({
        apexSource: 'System.debug(1);',
        logLevel: 'basic',
        timeoutMilliseconds: 1000,
      });

      const failure = await capturedFailure(execute);
      expect(failure).to.be.instanceOf(Error);
      expect((failure as Error).message).to.include('timeout expired before the session retry');
      expect(request.calledOnce).to.equal(true);
    } finally {
      clock.restore();
    }
  });
});

describe('ApexSoapExecuteAnonymous authentication identity', (): void => {
  it('derives the organisation ID from the selected auth-field token', async (): Promise<void> => {
    const request = sinon.stub().resolves(response());
    const fakeConnection = {
      accessToken: undefined,
      instanceUrl: 'https://example.my.salesforce.com',
      getApiVersion: (): string => '66.0',
      getAuthInfoFields: (): { accessToken: string } => ({ accessToken: '00D000000000099!auth-field-token' }),
      request,
      refreshAuth: sinon.stub().resolves(),
    } as unknown as Connection;

    await new ApexSoapExecuteAnonymous(fakeConnection).execute({
      apexSource: 'System.debug(1);',
      logLevel: 'basic',
    });

    expect((request.firstCall.args[0] as { url: string }).url).to.equal(
      'https://example.my.salesforce.com/services/Soap/s/66.0/00D000000000099'
    );
  });
});
