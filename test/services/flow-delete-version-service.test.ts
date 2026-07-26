/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDeleteVersionService } from '../../src/services/flow-delete-version-service.js';
import type { FlowDeleteVersionRequest } from '../../src/types/flow-deletion.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';
const first = flowVersion(definitionId, 1, 'Obsolete');
const active = flowVersion(definitionId, 2, 'Active');
const latest = flowVersion(definitionId, 3, 'Draft');

function request(overrides: Partial<FlowDeleteVersionRequest> = {}): FlowDeleteVersionRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    version: 1,
    dryRun: true,
    ...overrides,
  };
}

function gateway(): FakeFlowGateway {
  return new FakeFlowGateway(
    [
      flowDefinition({
        id: definitionId,
        apiName: 'Order_Processing',
        activeVersionId: active.id,
        latestVersionId: latest.id,
      }),
    ],
    [first, active, latest]
  );
}

describe('FlowDeleteVersionService planning', (): void => {
  it('returns a stable dry-run plan after checking permission', async (): Promise<void> => {
    const fake = gateway();
    const result = await new FlowDeleteVersionService(fake).deleteVersion(request());
    expect(result.plan).to.deep.equal({
      action: 'delete-version',
      versionId: first.id,
      versionNumber: 1,
      status: 'Obsolete',
      active: false,
      latest: false,
    });
    expect(result).to.include({ activeVersion: 2, latestVersion: 3, changed: false, dryRun: true });
    expect(fake.permissionChecks).to.deep.equal(['delete-version']);
    expect(fake.deletes).to.deep.equal([]);
  });

  it('refuses the active and latest versions', async (): Promise<void> => {
    await expectErrorName(
      new FlowDeleteVersionService(gateway()).deleteVersion(request({ version: 2 })),
      'FlowDeleteVersionFailed'
    );
    await expectErrorName(
      new FlowDeleteVersionService(gateway()).deleteVersion(request({ version: 3 })),
      'FlowDeleteVersionFailed'
    );
  });

  it('checks both optimistic concurrency guards', async (): Promise<void> => {
    await expectErrorName(
      new FlowDeleteVersionService(gateway()).deleteVersion(request({ expectedActiveVersion: 1 })),
      'FlowActiveVersionMismatch'
    );
    await expectErrorName(
      new FlowDeleteVersionService(gateway()).deleteVersion(request({ expectedLatestVersion: 2 })),
      'FlowLatestVersionMismatch'
    );
  });
});

describe('FlowDeleteVersionService mutation', (): void => {
  it('rechecks, deletes and verifies the selected version', async (): Promise<void> => {
    const fake = gateway();
    const result = await new FlowDeleteVersionService(fake).deleteVersion(
      request({ dryRun: false, expectedActiveVersion: 2, expectedLatestVersion: 3 })
    );
    expect(fake.versionQueries).to.deep.equal([definitionId, definitionId, definitionId]);
    expect(fake.deletes).to.deep.equal([first.id]);
    expect(result).to.include({ changed: true, dryRun: false });
  });

  it('fails verification when the version remains', async (): Promise<void> => {
    const fake = gateway();
    fake.persistDeletes = false;
    await expectErrorName(
      new FlowDeleteVersionService(fake).deleteVersion(request({ dryRun: false })),
      'FlowDeleteVersionVerificationFailed'
    );
  });

  it('fails a dry run when deletion permission is missing', async (): Promise<void> => {
    const fake = gateway();
    fake.allowVersionDeletes = false;
    await expectErrorName(new FlowDeleteVersionService(fake).deleteVersion(request()), 'FlowMutationPermissionDenied');
  });
});
