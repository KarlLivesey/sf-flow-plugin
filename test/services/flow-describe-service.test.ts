/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import { cycleGateway, inspectionRequest } from '../helpers/flow-inspection-fixtures.js';

describe('FlowDescribeService', (): void => {
  it('describes only the requested Flow when recursion is disabled', async (): Promise<void> => {
    const result = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest({ recursive: false }));
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A']);
    expect(result.warnings).to.deep.equal([]);
  });

  it('detects an A to B to A call cycle without expanding A twice', async (): Promise<void> => {
    const result = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest());
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(result.warnings).to.deep.equal([
      {
        kind: 'cycle',
        flowName: 'Flow_A',
        path: ['Flow_A', 'Flow_B', 'Flow_A'],
      },
    ]);
  });

  it('stops before expanding a subflow past the configured depth', async (): Promise<void> => {
    const result = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest({ maxDepth: 0 }));
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A']);
    expect(result.warnings[0]).to.deep.equal({
      kind: 'depth-limit',
      flowName: 'Flow_B',
      path: ['Flow_A', 'Flow_B'],
    });
  });
});
