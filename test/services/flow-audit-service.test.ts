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
    ).audit('admin@example.com');
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
    const result = await new FlowAuditService(new FakeFlowGateway([definition], [version])).audit('admin@example.com');
    expect(result).to.include({ definitionsScanned: 1, flowsWithIssues: 0 });
    expect(result.flows).to.deep.equal([]);
  });

  it('wraps query failures', async (): Promise<void> => {
    const gateway = new FakeFlowGateway([], []);
    gateway.queryError = new Error('request failed');
    const promise = new FlowAuditService(gateway).audit('admin@example.com');
    await expectErrorName(promise, 'FlowAuditFailed');
  });
});
