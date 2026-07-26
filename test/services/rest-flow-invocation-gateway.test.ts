/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import sinon from 'sinon';

import { RestFlowInvocationGateway } from '../../src/services/rest-flow-invocation-gateway.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

function connection(response: unknown): { connection: Connection; query: sinon.SinonStub; request: sinon.SinonStub } {
  const query = sinon.stub().resolves({ records: [{ IsSandbox: false }] });
  const request = sinon.stub().resolves(response);
  return {
    connection: {
      getApiVersion: (): string => '65.0',
      query,
      request,
    } as unknown as Connection,
    query,
    request,
  };
}

function httpApiError(errorCode: string, message: string): Error & { data: Record<string, never>; errorCode: string } {
  return Object.assign(new Error(message), {
    data: {},
    errorCode,
    name: errorCode,
  });
}

describe('RestFlowInvocationGateway', (): void => {
  it('detects production and sandbox orgs', async (): Promise<void> => {
    const production = connection({});
    expect(await new RestFlowInvocationGateway(production.connection).isProductionOrg()).to.equal(true);
    production.query.resolves({ records: [{ IsSandbox: true }] });
    expect(await new RestFlowInvocationGateway(production.connection).isProductionOrg()).to.equal(false);
  });

  it('checks the supported custom Flow action resource', async (): Promise<void> => {
    const fake = connection({});
    await new RestFlowInvocationGateway(fake.connection).assertFlowActionAvailable('example__Calculate_Discount');
    expect(fake.request.firstCall.args[0]).to.equal(
      '/services/data/v65.0/actions/custom/flow/example__Calculate_Discount'
    );
  });

  it('posts inputs and validates invocation results', async (): Promise<void> => {
    const response = [
      {
        actionName: 'Calculate_Discount',
        errors: null,
        invocationId: 'interview-1',
        isSuccess: true,
        outputValues: { discount: 10 },
        version: 1,
      },
    ];
    const fake = connection(response);
    const result = await new RestFlowInvocationGateway(fake.connection).invokeFlow('Calculate_Discount', [
      { percentage: 10 },
    ]);
    expect(result).to.deep.equal([{ ...response[0], errors: [] }]);
    expect(fake.request.firstCall.args[0]).to.deep.equal({
      method: 'POST',
      url: '/services/data/v65.0/actions/custom/flow/Calculate_Discount',
      body: '{"inputs":[{"percentage":10}]}',
    });
  });
});

describe('RestFlowInvocationGateway result normalisation', (): void => {
  it('normalises null output values for an unsuccessful invocation', async (): Promise<void> => {
    const fake = connection([
      {
        errors: [{ statusCode: 'FLOW_EXCEPTION' }],
        invocationId: null,
        isSuccess: false,
        outputValues: null,
      },
    ]);
    const result = await new RestFlowInvocationGateway(fake.connection).invokeFlow('Calculate_Discount', [{}]);
    expect(result[0]).to.include({ isSuccess: false });
    expect(result[0]?.outputValues).to.deep.equal({});
  });
});

describe('RestFlowInvocationGateway errors', (): void => {
  it('wraps malformed org and action responses', async (): Promise<void> => {
    const invalidOrg = connection({});
    invalidOrg.query.resolves({ records: [] });
    await expectErrorName(new RestFlowInvocationGateway(invalidOrg.connection).isProductionOrg(), 'FlowQueryFailed');
    const invalidAction = connection([{ isSuccess: 'yes' }]);
    await expectErrorName(
      new RestFlowInvocationGateway(invalidAction.connection).invokeFlow('Calculate_Discount', [{}]),
      'FlowInvocationFailed'
    );
  });

  it('reports recognised action authorisation failures as permission failures', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(httpApiError('INSUFFICIENT_ACCESS', 'forbidden'));
    await expectErrorName(
      new RestFlowInvocationGateway(fake.connection).assertFlowActionAvailable('Calculate_Discount'),
      'FlowInvocationPermissionDenied'
    );
  });

  it('reports other action discovery failures as redacted invocation failures', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(httpApiError('ERROR_HTTP_503', 'sensitive service response'));
    try {
      await new RestFlowInvocationGateway(fake.connection).assertFlowActionAvailable('Calculate_Discount');
      expect.fail('Expected FlowInvocationFailed.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).name).to.equal('FlowInvocationFailed');
      expect((error as Error).message).to.include('Status: ERROR_HTTP_503');
      expect((error as Error).message).not.to.include('sensitive service response');
    }
  });

  it('does not retain raw Salesforce transport errors as causes', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(httpApiError('ERROR_HTTP_503', 'sensitive Salesforce response'));
    try {
      await new RestFlowInvocationGateway(fake.connection).invokeFlow('Calculate_Discount', [{}]);
      expect.fail('Expected FlowInvocationFailed.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include('Status: ERROR_HTTP_503');
      expect((error as Error).message).not.to.include('sensitive Salesforce response');
      expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
    }
  });
});

describe('RestFlowInvocationGateway transport aliases', (): void => {
  it('preserves a numeric permission status from an ordinary Error', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    await expectErrorName(
      new RestFlowInvocationGateway(fake.connection).assertFlowActionAvailable('Calculate_Discount'),
      'FlowInvocationPermissionDenied'
    );
  });

  it('preserves a safe network code from an ordinary Error', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(Object.assign(new Error('sensitive network details'), { code: 'ECONNRESET' }));
    try {
      await new RestFlowInvocationGateway(fake.connection).invokeFlow('Calculate_Discount', [{}]);
      expect.fail('Expected FlowInvocationFailed.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include('Status: ECONNRESET');
      expect((error as Error).message).not.to.include('sensitive network details');
    }
  });
});
