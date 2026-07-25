/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowPruneService } from '../../src/services/flow-prune-service.js';
import type { FlowPruneRequest, FlowVersion } from '../../src/types/flow.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';

function request(overrides: Partial<FlowPruneRequest> = {}): FlowPruneRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    keep: 2,
    keepVersions: [],
    ignoreVersions: [],
    keepBy: 'created',
    dryRun: true,
    ...overrides,
  };
}

function versions(): FlowVersion[] {
  return [
    flowVersion(definitionId, 1, 'Obsolete'),
    flowVersion(definitionId, 2, 'Draft'),
    flowVersion(definitionId, 3, 'Draft'),
    flowVersion(definitionId, 4, 'Active'),
    flowVersion(definitionId, 5, 'Draft'),
    flowVersion(definitionId, 6, 'Paused'),
  ];
}

function gateway(items: FlowVersion[] = versions()): FakeFlowGateway {
  const definition = flowDefinition({
    id: definitionId,
    apiName: 'Order_Processing',
    activeVersionId: items.find((version) => version.versionNumber === 4)?.id ?? null,
    latestVersionId: items.find((version) => version.versionNumber === 5)?.id ?? null,
  });
  return new FakeFlowGateway([definition], items);
}

describe('FlowPruneService planning', (): void => {
  it('protects active and latest, retains the newest candidates and plans older deletions', async (): Promise<void> => {
    const result = await new FlowPruneService(gateway()).prune(request());
    expect(result.protectedVersions.map((version) => version.versionNumber)).to.deep.equal([4, 5]);
    expect(result.retainedVersions.map((version) => version.versionNumber)).to.deep.equal([3, 2]);
    expect(result.plannedDeletions.map((version) => version.versionNumber)).to.deep.equal([1]);
    expect(result.skippedVersions.map((version) => version.versionNumber)).to.deep.equal([6]);
    expect(result).to.include({ changed: false, dryRun: true });
  });

  it('counts explicitly retained versions within the keep total', async (): Promise<void> => {
    const result = await new FlowPruneService(gateway()).prune(request({ keep: 2, keepVersions: [1] }));
    expect(result.retainedVersions.map((version) => version.versionNumber)).to.deep.equal([1, 3]);
    expect(result.plannedDeletions.map((version) => version.versionNumber)).to.deep.equal([2]);
  });

  it('ignores explicit versions without reducing the keep total', async (): Promise<void> => {
    const result = await new FlowPruneService(gateway()).prune(request({ keep: 2, ignoreVersions: [1] }));
    expect(result.ignoredVersions.map((version) => version.versionNumber)).to.deep.equal([1]);
    expect(result.retainedVersions.map((version) => version.versionNumber)).to.deep.equal([3, 2]);
    expect(result.plannedDeletions).to.deep.equal([]);
  });

  it('gives ignore precedence over keep-version', async (): Promise<void> => {
    const result = await new FlowPruneService(gateway()).prune(
      request({ keep: 1, keepVersions: [1], ignoreVersions: [1] })
    );
    expect(result.keepVersions).to.deep.equal([]);
    expect(result.ignoredVersions.map((version) => version.versionNumber)).to.deep.equal([1]);
    expect(result.retainedVersions.map((version) => version.versionNumber)).to.deep.equal([3]);
    expect(result.plannedDeletions.map((version) => version.versionNumber)).to.deep.equal([2]);
  });

  it('can select retained versions by last modification date', async (): Promise<void> => {
    const items = versions().map((version) =>
      version.versionNumber === 1 ? { ...version, lastModifiedDate: '2026-12-01T00:00:00.000Z' } : version
    );
    const fake = gateway(items);
    const result = await new FlowPruneService(fake).prune(request({ keep: 1, keepBy: 'modified' }));
    expect(result.retainedVersions.map((version) => version.versionNumber)).to.deep.equal([1]);
  });

  it('rejects an invalid keep value at the service boundary', async (): Promise<void> => {
    const promise = new FlowPruneService(gateway()).prune(request({ keep: -1 }));
    await expectErrorName(promise, 'FlowPruneFailed');
  });
});

describe('FlowPruneService deletion', (): void => {
  it('deletes and verifies every planned version', async (): Promise<void> => {
    const fake = gateway();
    const result = await new FlowPruneService(fake).prune(request({ keep: 1, dryRun: false }));
    expect(result.deletedVersions.map((version) => version.versionNumber)).to.deep.equal([1, 2]);
    expect(fake.deletes).to.deep.equal(result.deletedVersions.map((version) => version.id));
    expect(result.changed).to.equal(true);
  });

  it('fails verification when Salesforce still returns a deleted version', async (): Promise<void> => {
    const fake = gateway();
    fake.persistDeletes = false;
    const promise = new FlowPruneService(fake).prune(request({ keep: 1, dryRun: false }));
    await expectErrorName(promise, 'FlowPruneVerificationFailed');
  });
});
