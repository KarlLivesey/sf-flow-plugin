/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowBundleService } from '../../src/services/flow-bundle-service.js';
import type { FlowBundleRequest } from '../../src/types/flow-bundle.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

function request(): FlowBundleRequest {
  return {
    apiName: 'Flow_A',
    targetOrg: 'admin@example.com',
    apiVersion: '65.0',
    version: 'latest',
    subflowVersion: 'active',
    maxDepth: 10,
    status: 'draft',
    outputDir: '/tmp/flow-bundle',
    overwrite: false,
  };
}

describe('FlowBundleService', (): void => {
  it('exports the visited root and subflow with manifests and external dependencies', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.dependencies.push({
      direction: 'uses',
      componentId: '01p000000000001',
      name: 'OrderAction',
      namespace: null,
      type: 'ApexClass',
    });
    const artifact = await new FlowBundleService(gateway).bundle(request());
    expect(artifact.result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(artifact.result.externalDependencies).to.deep.equal([
      { name: 'OrderAction', namespace: null, type: 'ApexClass' },
    ]);
    expect(artifact.files.map((file) => file.path)).to.include.members([
      '/tmp/flow-bundle/flows/Flow_A.flow-meta.xml',
      '/tmp/flow-bundle/flows/Flow_B.flow-meta.xml',
      '/tmp/flow-bundle/.sf-flow-bundle/package.xml',
      '/tmp/flow-bundle/.sf-flow-bundle/manifest.json',
    ]);
    expect(artifact.files.find((file) => file.path.endsWith('package.xml'))?.content).to.include(
      '<members>Flow_B</members>'
    );
  });

  it('refuses an incomplete dependency report', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    gateway.truncatedDependencyQueries.add('300000000000001:uses');
    await expectErrorName(new FlowBundleService(gateway).bundle(request()), 'FlowBundleFailed');
  });
});
