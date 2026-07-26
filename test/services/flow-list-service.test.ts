/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowListService } from '../../src/services/flow-list-service.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

describe('FlowListService inventory', (): void => {
  it('lists definitions using active and latest version details', async (): Promise<void> => {
    const definitionId = '300000000000001';
    const active = flowVersion(definitionId, 1, 'Active');
    const latest = {
      ...flowVersion(definitionId, 2, 'Draft'),
      label: 'Order Processing',
      processType: 'AutoLaunchedFlow',
      lastModifiedDate: '2026-07-26T10:00:00.000Z',
    };
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Order_Processing',
      activeVersionId: active.id,
      latestVersionId: latest.id,
    });
    const result = await new FlowListService(new FakeFlowGateway([definition], [active, latest])).list({
      targetOrg: 'admin@example.com',
    });
    expect(result).to.deep.equal({
      targetOrg: 'admin@example.com',
      definitions: [
        {
          apiName: 'Order_Processing',
          namespace: null,
          definitionId,
          label: 'Order Processing',
          processType: 'AutoLaunchedFlow',
          activeVersion: 1,
          latestVersion: 2,
          status: 'Draft',
          lastModifiedDate: '2026-07-26T10:00:00.000Z',
        },
      ],
    });
  });
});

describe('FlowListService empty and invalid states', (): void => {
  it('reports definitions without versions using null inventory values', async (): Promise<void> => {
    const definition = flowDefinition({
      id: '300000000000001',
      apiName: 'Empty_Flow',
      activeVersionId: null,
      latestVersionId: null,
    });
    const result = await new FlowListService(new FakeFlowGateway([definition], [])).list({
      targetOrg: 'admin@example.com',
    });
    expect(result.definitions[0]).to.include({
      activeVersion: null,
      latestVersion: null,
      label: null,
      processType: null,
      status: null,
      lastModifiedDate: null,
    });
  });

  it('rejects an unavailable referenced version', async (): Promise<void> => {
    const definition = flowDefinition({
      id: '300000000000001',
      apiName: 'Broken_Flow',
      activeVersionId: null,
      latestVersionId: '301000000000001',
    });
    await expectErrorName(
      new FlowListService(new FakeFlowGateway([definition], [])).list({ targetOrg: 'admin@example.com' }),
      'FlowListFailed'
    );
  });
});
