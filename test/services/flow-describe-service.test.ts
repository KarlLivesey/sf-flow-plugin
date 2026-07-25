/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import { inspectionRequest, nestedFlowGateway, versionedSubflowGateway } from '../helpers/flow-inspection-fixtures.js';

describe('FlowDescribeService', (): void => {
  it('describes only the requested Flow when recursion is disabled', async (): Promise<void> => {
    const result = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest({ recursive: false }));
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A']);
    expect(result.warnings).to.deep.equal([]);
  });

  it('recursively describes a called subflow', async (): Promise<void> => {
    const result = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(result.warnings).to.deep.equal([]);
  });

  it('stops before expanding a subflow past the configured depth', async (): Promise<void> => {
    const result = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest({ maxDepth: 0 }));
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['Flow_A']);
    expect(result.warnings[0]).to.deep.equal({
      kind: 'depth-limit',
      flowName: 'Flow_B',
      path: ['Flow_A', 'Flow_B'],
    });
  });
});

describe('FlowDescribeService subflow version selection', (): void => {
  it('follows the active subflow version by default', async (): Promise<void> => {
    const result = await new FlowDescribeService(versionedSubflowGateway(true)).describe(inspectionRequest());
    expect(result.flows[1]?.versionNumber).to.equal(1);
    expect(result.warnings).to.deep.equal([]);
  });

  it('can follow the latest subflow version explicitly', async (): Promise<void> => {
    const result = await new FlowDescribeService(versionedSubflowGateway(true)).describe(
      inspectionRequest({ subflowVersion: 'latest' })
    );
    expect(result.flows[1]?.versionNumber).to.equal(2);
    expect(result.subflowVersion).to.equal('latest');
  });

  it('falls back to latest when no active subflow version exists', async (): Promise<void> => {
    const result = await new FlowDescribeService(versionedSubflowGateway(false)).describe(inspectionRequest());
    expect(result.flows[1]?.versionNumber).to.equal(2);
    expect(result.warnings).to.deep.equal([
      {
        kind: 'subflow-version-fallback',
        flowName: 'Flow_B',
        path: ['Flow_A', 'Flow_B'],
      },
    ]);
  });
});
