/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowGraphService } from '../../src/services/flow-graph-service.js';
import type { FlowGraphRequest } from '../../src/types/flow-inspection.js';
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

function graphRequest(): FlowGraphRequest {
  return {
    ...inspectionRequest({ recursive: false }),
    format: 'mermaid',
    includeVariables: false,
    includeFormulas: false,
    direction: 'auto',
    legend: true,
    labelWidth: 24,
    style: {
      colors: {},
      fontFamily: 'Arial',
      fontSize: 14,
    },
  };
}

describe('FlowGraphService', (): void => {
  it('resolves automatic layout and reports all rendering options', async (): Promise<void> => {
    const result = await new FlowGraphService(nestedFlowGateway()).graph(graphRequest());
    expect(result.requestedDirection).to.equal('auto');
    expect(result.resolvedDirection).to.equal('left-right');
    expect(result.legend).to.equal(true);
    expect(result.labelWidth).to.equal(24);
    expect(result.graph).to.include('flowchart LR');
    expect(result.graph).to.include('subgraph flowLegend["Legend"]');
  });
});
