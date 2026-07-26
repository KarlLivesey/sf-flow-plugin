/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowComparisonService } from '../../src/services/flow-comparison-service.js';
import type { FlowCompareRequest } from '../../src/types/flow-analysis.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';
const versions = [flowVersion(definitionId, 1, 'Active'), flowVersion(definitionId, 2, 'Draft')];

function request(overrides: Partial<FlowCompareRequest> = {}): FlowCompareRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    fromOrg: 'admin@example.com',
    toOrg: 'admin@example.com',
    from: 'active',
    to: 'latest',
    scopes: [],
    ignoreOrder: false,
    ...overrides,
  };
}

function gateway(activeVersionId: string | null = versions[0]?.id ?? null): FakeFlowGateway {
  const definition = flowDefinition({
    id: definitionId,
    apiName: 'Order_Processing',
    activeVersionId,
    latestVersionId: versions[1]?.id ?? null,
  });
  const fake = new FakeFlowGateway([definition], versions);
  fake.metadata.set(versions[0]?.id ?? '', { status: 'Active', label: 'One' });
  fake.metadata.set(versions[1]?.id ?? '', { status: 'Draft', label: 'Two' });
  return fake;
}

describe('FlowComparisonService', (): void => {
  it('compares active and latest metadata without lifecycle status noise', async (): Promise<void> => {
    const result = await new FlowComparisonService(gateway()).compare(request());
    expect(result).to.include({ fromVersion: 1, toVersion: 2, changed: 1, different: true });
    expect(result.changes).to.deep.equal([{ kind: 'changed', path: '$.label', before: 'One', after: 'Two' }]);
  });

  it('resolves explicit version numbers', async (): Promise<void> => {
    const result = await new FlowComparisonService(gateway()).compare(request({ from: 2, to: 2 }));
    expect(result).to.include({ fromVersion: 2, toVersion: 2, different: false });
    expect(result.changes).to.deep.equal([]);
  });

  it('fails when the Flow has no active version', async (): Promise<void> => {
    await expectErrorName(new FlowComparisonService(gateway(null)).compare(request()), 'FlowComparisonFailed');
  });

  it('fails when an explicit version does not exist', async (): Promise<void> => {
    await expectErrorName(new FlowComparisonService(gateway()).compare(request({ from: 99 })), 'FlowVersionNotFound');
  });
});

describe('FlowComparisonService cross-org comparisons', (): void => {
  it('resolves and compares the Flow independently in each org', async (): Promise<void> => {
    const source = gateway();
    const targetDefinitionId = '300000000000101';
    const targetVersion = flowVersion(targetDefinitionId, 4, 'Active');
    const target = new FakeFlowGateway(
      [
        flowDefinition({
          id: targetDefinitionId,
          apiName: 'Order_Processing',
          activeVersionId: targetVersion.id,
          latestVersionId: targetVersion.id,
        }),
      ],
      [targetVersion]
    );
    target.metadata.set(targetVersion.id, { status: 'Active', label: 'Target' });
    const result = await new FlowComparisonService(source, target).compare(
      request({
        from: 'latest',
        to: 'active',
        fromOrg: 'developer@example.com',
        toOrg: 'preprod@example.com',
      })
    );
    expect(result).to.include({
      fromDefinitionId: definitionId,
      toDefinitionId: targetDefinitionId,
      fromVersion: 2,
      toVersion: 4,
      crossOrg: true,
    });
  });
});
