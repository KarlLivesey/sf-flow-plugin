/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowCheckService } from '../../src/services/flow-check-service.js';
import type { FlowCheckRequest } from '../../src/types/flow-check.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

function request(overrides: Partial<FlowCheckRequest> = {}): FlowCheckRequest {
  return {
    apiNames: ['Flow_A'],
    targetOrg: 'admin@example.com',
    version: 'latest',
    subflowVersion: 'active',
    checks: [],
    excludedChecks: [],
    recursive: false,
    maxDepth: 10,
    allowTruncated: false,
    ...overrides,
  };
}

describe('FlowCheckService', (): void => {
  it('runs the default read-only checks and reports contracts', async (): Promise<void> => {
    const result = await new FlowCheckService(nestedFlowGateway()).check(request());
    expect(result.checks).to.deep.equal(['lint', 'dependencies', 'subflows', 'versions']);
    expect(result.flows[0]?.contracts[0]?.inputs.map((input) => input.name)).to.deep.equal(['InputValue']);
    expect(result.flows[0]?.metrics).to.equal(null);
  });

  it('runs metrics only when selected', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    const result = await new FlowCheckService(gateway).check(request({ checks: ['metrics'], recursive: true }));
    expect(result.checks).to.deep.equal(['metrics']);
    expect(result.flows[0]?.metrics?.flows.map((flow) => flow.apiName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(gateway.metadataQueries).to.deep.equal(['301000000000000001', '301000000000100002']);
  });

  it('reports dependency truncation as an error unless explicitly allowed', async (): Promise<void> => {
    const blockedGateway = nestedFlowGateway();
    blockedGateway.truncatedDependencyQueries.add('300000000000001:uses');
    const blocked = await new FlowCheckService(blockedGateway).check(request({ checks: ['dependencies'] }));
    const allowedGateway = nestedFlowGateway();
    allowedGateway.truncatedDependencyQueries.add('300000000000001:uses');
    const allowed = await new FlowCheckService(allowedGateway).check(
      request({ checks: ['dependencies'], allowTruncated: true })
    );
    expect(blocked.findings[0]?.severity).to.equal('error');
    expect(allowed.findings[0]?.severity).to.equal('warning');
  });

  it('runs version checks without loading Flow metadata', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.metadata.clear();
    const result = await new FlowCheckService(gateway).check(request({ checks: ['versions'] }));
    expect(result.flows[0]).to.include({ apiName: 'Flow_A', resolvedVersion: 1 });
    expect(result.flows[0]?.contracts).to.deep.equal([]);
  });

  it('runs dependency checks without loading Flow metadata', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.metadata.clear();
    const result = await new FlowCheckService(gateway).check(request({ checks: ['dependencies'] }));
    expect(result.flows[0]).to.include({ apiName: 'Flow_A', resolvedVersion: 1 });
    expect(result.flows[0]?.contracts).to.deep.equal([]);
  });
});
