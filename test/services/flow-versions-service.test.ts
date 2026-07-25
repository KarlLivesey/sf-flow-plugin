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
    });
    await expectErrorName(promise, 'FlowDefinitionNotFound');
  });
});
