/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowVersionsService } from '../../src/services/flow-versions-service.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';

describe('FlowVersionsService', (): void => {
  it('lists versions and identifies the active and latest versions', async (): Promise<void> => {
    const versions = [flowVersion(definitionId, 1, 'Active'), flowVersion(definitionId, 2, 'Draft')];
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Order_Processing',
      activeVersionId: versions[0]?.id ?? null,
      latestVersionId: versions[1]?.id ?? null,
    });
    const result = await new FlowVersionsService(new FakeFlowGateway([definition], versions)).getVersions({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      statuses: [],
      sort: 'version',
      order: 'asc',
    });
    expect(result.activeVersion).to.equal(1);
    expect(result.latestVersion).to.equal(2);
    expect(result.versions.map((version) => [version.versionNumber, version.active, version.latest])).to.deep.equal([
      [1, true, false],
      [2, false, true],
    ]);
  });

  it('reports a missing definition', async (): Promise<void> => {
    const promise = new FlowVersionsService(new FakeFlowGateway([], [])).getVersions({
      apiName: 'Missing_Flow',
      targetOrg: 'admin@example.com',
      statuses: [],
      sort: 'version',
      order: 'asc',
    });
    await expectErrorName(promise, 'FlowDefinitionNotFound');
  });
});

describe('FlowVersionsService filtering', (): void => {
  it('returns the newest matching statuses up to the requested limit', async (): Promise<void> => {
    const versions = [
      flowVersion(definitionId, 1, 'Draft'),
      flowVersion(definitionId, 2, 'Active'),
      flowVersion(definitionId, 3, 'Draft'),
      flowVersion(definitionId, 4, 'InvalidDraft'),
    ];
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Order_Processing',
      activeVersionId: versions[1]?.id ?? null,
      latestVersionId: versions[3]?.id ?? null,
    });
    const result = await new FlowVersionsService(new FakeFlowGateway([definition], versions)).getVersions({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      statuses: ['Draft', 'InvalidDraft'],
      sort: 'version',
      order: 'asc',
      limit: 2,
    });
    expect(result.versions.map((version) => version.versionNumber)).to.deep.equal([3, 4]);
  });

  it('filters by creation date and sorts the selected versions', async (): Promise<void> => {
    const versions = [
      flowVersion(definitionId, 1, 'Draft'),
      flowVersion(definitionId, 2, 'Draft'),
      flowVersion(definitionId, 3, 'Draft'),
      flowVersion(definitionId, 4, 'Draft'),
    ];
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Order_Processing',
      activeVersionId: null,
      latestVersionId: versions[3]?.id ?? null,
    });
    const result = await new FlowVersionsService(new FakeFlowGateway([definition], versions)).getVersions({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      statuses: [],
      createdAfter: '2026-01-01',
      createdBefore: '2026-01-04',
      sort: 'modified',
      order: 'desc',
    });
    expect(result.versions.map((version) => version.versionNumber)).to.deep.equal([3, 2]);
  });
});

describe('FlowVersionsService modification filters', (): void => {
  it('filters by modification date', async (): Promise<void> => {
    const versions = [1, 2, 3, 4].map((number) => flowVersion(definitionId, number, 'Draft'));
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Order_Processing',
      activeVersionId: null,
      latestVersionId: versions[3]?.id ?? null,
    });
    const result = await new FlowVersionsService(new FakeFlowGateway([definition], versions)).getVersions({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      statuses: [],
      modifiedAfter: '2026-02-01',
      modifiedBefore: '2026-02-04',
      sort: 'version',
      order: 'asc',
    });
    expect(result.versions.map((version) => version.versionNumber)).to.deep.equal([2, 3]);
  });
});
