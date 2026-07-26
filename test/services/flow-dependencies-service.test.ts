/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDependenciesService } from '../../src/services/flow-dependencies-service.js';
import type { FlowDependenciesRequest } from '../../src/types/flow-analysis.js';
import { expectErrorName, FakeFlowGateway, flowDefinition } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';

function request(overrides: Partial<FlowDependenciesRequest> = {}): FlowDependenciesRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    direction: 'both',
    ...overrides,
  };
}

function gateway(): FakeFlowGateway {
  const definition = flowDefinition({
    id: definitionId,
    apiName: 'Order_Processing',
    activeVersionId: null,
    latestVersionId: null,
  });
  const fake = new FakeFlowGateway([definition], []);
  fake.dependencies.push(
    { direction: 'uses', componentId: '01I000000000001', name: 'Account', namespace: null, type: 'CustomObject' },
    { direction: 'uses', componentId: '01I000000000001', name: 'Account', namespace: null, type: 'CustomObject' },
    { direction: 'used-by', componentId: '301000000000001', name: 'Parent_Flow', namespace: null, type: 'Flow' }
  );
  return fake;
}

describe('FlowDependenciesService', (): void => {
  it('combines directions, removes duplicates and sorts the result', async (): Promise<void> => {
    const fake = gateway();
    const result = await new FlowDependenciesService(fake).getDependencies(request());
    expect(fake.dependencyQueries).to.deep.equal([
      { definitionId, direction: 'uses' },
      { definitionId, direction: 'used-by' },
    ]);
    expect(result.dependencies).to.deep.equal([
      {
        direction: 'used-by',
        componentId: '301000000000001',
        name: 'Parent_Flow',
        namespace: null,
        type: 'Flow',
      },
      {
        direction: 'uses',
        componentId: '01I000000000001',
        name: 'Account',
        namespace: null,
        type: 'CustomObject',
      },
    ]);
  });

  it('queries only the requested direction', async (): Promise<void> => {
    const result = await new FlowDependenciesService(gateway()).getDependencies(request({ direction: 'uses' }));
    expect(result.dependencies).to.have.length(1);
    expect(result.dependencies[0]?.direction).to.equal('uses');
  });

  it('rejects invalid directions at the service boundary', async (): Promise<void> => {
    const invalid = { ...request(), direction: 'sideways' as FlowDependenciesRequest['direction'] };
    await expectErrorName(new FlowDependenciesService(gateway()).getDependencies(invalid), 'FlowDependenciesFailed');
  });
});
