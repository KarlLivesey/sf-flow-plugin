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

  it('reports action discovery failures as permission failures', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(new Error('forbidden'));
    await expectErrorName(
      new RestFlowInvocationGateway(fake.connection).assertFlowActionAvailable('Calculate_Discount'),
      'FlowInvocationPermissionDenied'
    );
  });

  it('does not retain raw Salesforce transport errors as causes', async (): Promise<void> => {
    const fake = connection({});
    fake.request.rejects(Object.assign(new Error('sensitive Salesforce response'), { statusCode: 503 }));
    try {
      await new RestFlowInvocationGateway(fake.connection).invokeFlow('Calculate_Discount', [{}]);
      expect.fail('Expected FlowInvocationFailed.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include('Status: 503');
      expect((error as Error).message).not.to.include('sensitive Salesforce response');
      expect((error as Error & { cause?: unknown }).cause).to.equal(undefined);
    }
  });
});
