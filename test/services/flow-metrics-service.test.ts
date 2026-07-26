/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowMetricsService } from '../../src/services/flow-metrics-service.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

describe('FlowMetricsService', (): void => {
  it('aggregates recursively selected Flow versions', async (): Promise<void> => {
    const result = await new FlowMetricsService(nestedFlowGateway()).calculate({
      apiName: 'Flow_A',
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      recursive: true,
      maxDepth: 10,
    });
    expect(result.flows.map((flow) => flow.apiName)).to.deep.equal(['Flow_A', 'Flow_B']);
    expect(result.totals.subflows).to.equal(1);
    expect(result.recursive).to.equal(true);
  });
});
