/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowAuditService } from '../../src/services/flow-audit-service.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

describe('FlowAuditService', (): void => {
  it('reports inactive, behind, draft and obsolete Flow states', async (): Promise<void> => {
    const firstId = '300000000000001';
    const secondId = '300000000000002';
    const firstVersions = [flowVersion(firstId, 1, 'Active'), flowVersion(firstId, 2, 'Draft')];
    const secondVersions = [flowVersion(secondId, 1, 'Obsolete')];
    const definitions = [
      flowDefinition({
        id: firstId,
        apiName: 'Behind_Flow',
        activeVersionId: firstVersions[0]?.id ?? null,
        latestVersionId: firstVersions[1]?.id ?? null,
      }),
      flowDefinition({
        id: secondId,
        apiName: 'Inactive_Flow',
        activeVersionId: null,
        latestVersionId: secondVersions[0]?.id ?? null,
      }),
    ];
    const result = await new FlowAuditService(
      new FakeFlowGateway(definitions, [...firstVersions, ...secondVersions])
    ).audit({ targetOrg: 'admin@example.com', apiNames: [], maxInactiveVersions: 0 });
    expect(result).to.include({ definitionsScanned: 2, flowsWithIssues: 2 });
    expect(result.flows[0]?.issues).to.deep.equal(['ActiveVersionBehindLatest', 'DraftVersionsPresent']);
    expect(result.flows[1]?.issues).to.deep.equal(['NoActiveVersion', 'ObsoleteVersionsPresent']);
  });
});

describe('FlowAuditService clean and failure states', (): void => {
  it('omits a clean Flow from the issue list', async (): Promise<void> => {
    const definitionId = '300000000000001';
    const version = flowVersion(definitionId, 1, 'Active');
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Clean_Flow',
      activeVersionId: version.id,
      latestVersionId: version.id,
    });
    const result = await new FlowAuditService(new FakeFlowGateway([definition], [version])).audit({
      targetOrg: 'admin@example.com',
      apiNames: [],
      maxInactiveVersions: 0,
    });
    expect(result).to.include({ definitionsScanned: 1, flowsWithIssues: 0 });
    expect(result.flows).to.deep.equal([]);
  });

  it('wraps query failures', async (): Promise<void> => {
    const gateway = new FakeFlowGateway([], []);
    gateway.queryError = new Error('request failed');
    const promise = new FlowAuditService(gateway).audit({
      targetOrg: 'admin@example.com',
      apiNames: [],
      maxInactiveVersions: 0,
    });
    await expectErrorName(promise, 'FlowAuditFailed');
  });
});

describe('FlowAuditService filtering', (): void => {
  it('audits only the requested API names', async (): Promise<void> => {
    const firstId = '300000000000001';
    const secondId = '300000000000002';
    const firstVersion = flowVersion(firstId, 1, 'Draft');
    const secondVersion = flowVersion(secondId, 1, 'Draft');
    const definitions = [
      flowDefinition({
        id: firstId,
        apiName: 'Selected_Flow',
        activeVersionId: null,
        latestVersionId: firstVersion.id,
      }),
      flowDefinition({
        id: secondId,
        apiName: 'Other_Flow',
        activeVersionId: null,
        latestVersionId: secondVersion.id,
      }),
    ];
    const result = await new FlowAuditService(new FakeFlowGateway(definitions, [firstVersion, secondVersion])).audit({
      targetOrg: 'admin@example.com',
      apiNames: ['Selected_Flow', 'Selected_Flow'],
      maxInactiveVersions: 0,
    });
    expect(result).to.include({ definitionsScanned: 1, flowsWithIssues: 1 });
    expect(result.flows[0]?.apiName).to.equal('Selected_Flow');
  });
});

describe('FlowAuditService inactive-version thresholds', (): void => {
  it('applies the inactive-version threshold only to versions older than the age cutoff', async (): Promise<void> => {
    const definitionId = '300000000000001';
    const active = flowVersion(definitionId, 1, 'Active');
    const oldDraft = { ...flowVersion(definitionId, 2, 'Draft'), lastModifiedDate: '2026-01-01T00:00:00.000Z' };
    const recentDraft = { ...flowVersion(definitionId, 3, 'Draft'), lastModifiedDate: '2026-07-20T00:00:00.000Z' };
    const oldObsolete = {
      ...flowVersion(definitionId, 4, 'Obsolete'),
      lastModifiedDate: '2026-01-02T00:00:00.000Z',
    };
    const definition = flowDefinition({
      id: definitionId,
      apiName: 'Accumulated_Flow',
      activeVersionId: active.id,
      latestVersionId: active.id,
    });
    const result = await new FlowAuditService(
      new FakeFlowGateway([definition], [active, oldDraft, recentDraft, oldObsolete]),
      () => new Date('2026-07-26T00:00:00.000Z')
    ).audit({
      targetOrg: 'admin@example.com',
      apiNames: [],
      maxInactiveVersions: 1,
      olderThanDays: 30,
    });
    expect(result).to.include({ maxInactiveVersions: 1, olderThanDays: 30, flowsWithIssues: 1 });
    expect(result.flows[0]).to.include({ draftVersions: 1, obsoleteVersions: 1 });
    expect(result.flows[0]?.issues).to.deep.equal(['DraftVersionsPresent', 'ObsoleteVersionsPresent']);
  });
});
