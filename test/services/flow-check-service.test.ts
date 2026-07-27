/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowCheckService } from '../../src/services/flow-check-service.js';
import type { FlowCheckRequest } from '../../src/types/flow-check.js';
import type { FlowDefinition } from '../../src/types/flow.js';
import { nestedFlowGateway, subflowMetadata } from '../helpers/flow-inspection-fixtures.js';

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
    expect(gateway.versionQueries).to.deep.equal(['300000000000001', '300000000000101']);
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

describe('FlowCheckService lint concurrency', (): void => {
  it('bounds referenced-subflow definition lookups across Flow linting', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.metadata.set('301000000000000001', {
      subflows: Array.from({ length: 12 }, (_, index) => ({
        name: `Call_Missing_${index}`,
        flowName: `Missing_Child_${index}`,
      })),
    });
    const originalFindDefinitions = gateway.findDefinitions.bind(gateway);
    let active = 0;
    let maximumActive = 0;
    gateway.findDefinitions = async (lookup): Promise<ReadonlyArray<FlowDefinition>> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      try {
        return await originalFindDefinitions(lookup);
      } finally {
        active -= 1;
      }
    };
    await new FlowCheckService(gateway).check(request({ checks: ['lint', 'subflows'] }));
    expect(maximumActive).to.equal(4);
  });
});

describe('FlowCheckService query selection', (): void => {
  it('does not query referenced subflows when only lint is selected', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    const result = await new FlowCheckService(gateway).check(request({ checks: ['lint'], recursive: true }));
    expect(result.checks).to.deep.equal(['lint']);
    expect(result.flows[0]?.contracts[0]?.inputs.map((input) => input.name)).to.deep.equal(['InputValue']);
    expect(gateway.definitionQueries.map((lookup) => lookup.apiName)).to.deep.equal(['Flow_A', 'Flow_A']);
    expect(gateway.versionQueries).to.deep.equal(['300000000000001', '300000000000001']);
  });
});

describe('FlowCheckService recursive subflow findings', (): void => {
  it('reports one finding for a missing referenced subflow', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.metadata.set('301000000000000001', subflowMetadata('Missing_Flow'));
    const result = await new FlowCheckService(gateway).check(request({ checks: ['subflows'], recursive: true }));
    expect(result.findings.filter((finding) => finding.code === 'missing-subflow')).to.have.length(1);
    expect(result).to.include({ errors: 1, warnings: 0 });
  });

  it('reports a malformed referenced subflow without aborting the aggregated check', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.metadata.set('301000000000000001', subflowMetadata('not a valid Flow name'));
    const result = await new FlowCheckService(gateway).check(request({ checks: ['subflows'], recursive: true }));
    expect(result.findings).to.deep.include({
      apiName: 'Flow_A',
      namespace: null,
      version: 1,
      check: 'subflows',
      code: 'missing-subflow',
      severity: 'error',
      message: 'missing-subflow: Flow_A -> not a valid Flow name',
      path: 'Flow_A -> not a valid Flow name',
    });
    expect(result).to.include({ errors: 1, warnings: 0 });
  });
});
