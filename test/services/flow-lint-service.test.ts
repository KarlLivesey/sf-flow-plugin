/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowLintService } from '../../src/services/flow-lint-service.js';
import type { FlowLintRequest } from '../../src/types/flow-inspection.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const rootId = '300000000000001';
const childId = '300000000000002';

function lintRequest(): FlowLintRequest {
  return {
    apiName: 'Root_Flow',
    targetOrg: 'admin@example.com',
    version: 'latest',
  };
}

describe('FlowLintService version selection', (): void => {
  it('lints the requested numbered version', async (): Promise<void> => {
    const first = flowVersion(rootId, 1, 'Active');
    const latest = flowVersion(rootId, 2, 'Draft');
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: rootId,
          apiName: 'Root_Flow',
          activeVersionId: first.id,
          latestVersionId: latest.id,
        }),
      ],
      [first, latest]
    );
    gateway.metadata.set(first.id, {});
    const result = await new FlowLintService(gateway).lint({ ...lintRequest(), version: 1 });
    expect(result.resolvedVersion).to.equal(1);
    expect(result.targetOrg).to.equal('admin@example.com');
  });
});

describe('FlowLintService subflow rules', (): void => {
  it('reports inactive and missing subflows', async (): Promise<void> => {
    const root = flowVersion(rootId, 1, 'Active');
    const child = flowVersion(childId, 1, 'Draft');
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: rootId,
          apiName: 'Root_Flow',
          activeVersionId: root.id,
          latestVersionId: root.id,
        }),
        flowDefinition({
          id: childId,
          apiName: 'Inactive_Child',
          activeVersionId: null,
          latestVersionId: child.id,
        }),
      ],
      [root, child]
    );
    gateway.metadata.set(root.id, {
      subflows: [
        { name: 'Call_Inactive', flowName: 'Inactive_Child' },
        { name: 'Call_Missing', flowName: 'Missing_Child' },
      ],
    });
    const result = await new FlowLintService(gateway).lint(lintRequest());
    expect(result.findings.map((item) => item.rule)).to.include.members(['inactive-subflow', 'missing-subflow']);
    expect(result.errors).to.equal(1);
  });
});
