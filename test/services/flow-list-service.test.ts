/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowListService } from '../../src/services/flow-list-service.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const defaultRequest = {
  targetOrg: 'admin@example.com',
  apiNames: [],
  types: [],
  namespaces: [],
  statuses: [],
  sort: 'api-name' as const,
  order: 'asc' as const,
};

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
    const result = await new FlowListService(new FakeFlowGateway([definition], [active, latest])).list(defaultRequest);
    expect(result).to.deep.equal({
      targetOrg: 'admin@example.com',
      filters: { apiNames: [], types: [], namespaces: [], statuses: [] },
      sort: 'api-name',
      order: 'asc',
      limit: null,
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
    const result = await new FlowListService(new FakeFlowGateway([definition], [])).list(defaultRequest);
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
      new FlowListService(new FakeFlowGateway([definition], [])).list(defaultRequest),
      'FlowListFailed'
    );
  });
});

describe('FlowListService filters and ordering', (): void => {
  it('filters, sorts and limits the bulk inventory', async (): Promise<void> => {
    const first = flowVersion('300000000000001', 2, 'Draft');
    const second = flowVersion('300000000000002', 3, 'Draft');
    const definitions = [
      flowDefinition({
        id: first.definitionId,
        apiName: 'Zulu_Flow',
        activeVersionId: null,
        latestVersionId: first.id,
      }),
      flowDefinition({
        id: second.definitionId,
        apiName: 'Alpha_Flow',
        activeVersionId: null,
        latestVersionId: second.id,
      }),
    ];
    const result = await new FlowListService(new FakeFlowGateway(definitions, [first, second])).list({
      ...defaultRequest,
      apiNames: ['Alpha_Flow', 'Zulu_Flow'],
      statuses: ['Draft'],
      sort: 'latest-version',
      order: 'desc',
      limit: 1,
    });
    expect(result.definitions.map((entry) => entry.apiName)).to.deep.equal(['Alpha_Flow']);
    expect(result.limit).to.equal(1);
    expect(result.filters.statuses).to.deep.equal(['Draft']);
  });

  it('rejects a non-positive limit', async (): Promise<void> => {
    await expectErrorName(
      new FlowListService(new FakeFlowGateway([], [])).list({ ...defaultRequest, limit: 0 }),
      'FlowListFailed'
    );
  });
});
