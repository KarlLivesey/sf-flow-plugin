/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import { renderFlowGraph } from '../../src/utils/flow-graph-renderer.js';
import { cycleGateway, inspectionRequest } from '../helpers/flow-inspection-fixtures.js';

describe('renderFlowGraph', (): void => {
  it('retains both call edges when rendering a recursive Mermaid cycle', async (): Promise<void> => {
    const described = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
    });
    expect(graph).to.include('flowchart TD');
    expect(graph.match(/calls/g)).to.have.length(2);
    expect(graph).to.include('f0_e1 -. "calls" .-> f1_e0');
    expect(graph).to.include('f1_e1 -. "calls" .-> f0_e0');
  });

  it('renders DOT call edges for the same cycle', async (): Promise<void> => {
    const described = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
    });
    expect(graph).to.include('digraph Flow {');
    expect(graph.match(/label="calls"/g)).to.have.length(2);
  });

  it('includes variable and formula nodes only when requested', async (): Promise<void> => {
    const described = await new FlowDescribeService(cycleGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: true,
      includeFormulas: true,
    });
    expect(graph).to.include('Variable: InputValue');
    expect(graph).to.include('Formula: Greeting = &quot;Hello&quot;');
    expect(graph.match(/defines/g)).to.have.length(2);
  });
});
