/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDeactivationService } from '../../src/services/flow-deactivation-service.js';
import type { FlowDeactivationRequest } from '../../src/types/flow.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';
const active = flowVersion(definitionId, 1, 'Active');

function request(dryRun = false): FlowDeactivationRequest {
  return { apiName: 'Order_Processing', targetOrg: 'admin@example.com', dryRun };
}

describe('FlowDeactivationService', (): void => {
  it('previews without changing the active version', async (): Promise<void> => {
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Order_Processing',
          activeVersionId: active.id,
          latestVersionId: active.id,
        }),
      ],
      [active]
    );
    const result = await new FlowDeactivationService(gateway).deactivate(request(true));
    expect(result).to.include({ previousActiveVersion: 1, activeVersion: null, changed: false, dryRun: true });
    expect(gateway.updates).to.deep.equal([]);
  });

  it('is idempotent when the Flow is already inactive', async (): Promise<void> => {
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Order_Processing',
          activeVersionId: null,
          latestVersionId: active.id,
        }),
      ],
      [active]
    );
    const result = await new FlowDeactivationService(gateway).deactivate(request());
    expect(result.changed).to.equal(false);
    expect(gateway.updates).to.deep.equal([]);
  });
});

describe('FlowDeactivationService mutation', (): void => {
  it('clears and verifies the active version', async (): Promise<void> => {
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Order_Processing',
          activeVersionId: active.id,
          latestVersionId: active.id,
        }),
      ],
      [active]
    );
    const result = await new FlowDeactivationService(gateway).deactivate(request());
    expect(gateway.updates).to.deep.equal([{ definitionId, versionNumber: null }]);
    expect(result.changed).to.equal(true);
  });

  it('fails when Salesforce does not persist the deactivation', async (): Promise<void> => {
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Order_Processing',
          activeVersionId: active.id,
          latestVersionId: active.id,
        }),
      ],
      [active]
    );
    gateway.persistUpdates = false;
    const promise = new FlowDeactivationService(gateway).deactivate(request());
    await expectErrorName(promise, 'FlowDeactivationVerificationFailed');
  });
});
