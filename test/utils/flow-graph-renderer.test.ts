/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import { renderFlowGraph } from '../../src/utils/flow-graph-renderer.js';
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

describe('renderFlowGraph', (): void => {
  it('renders a recursive Mermaid subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
    });
    expect(graph).to.include('flowchart TD');
    expect(graph.match(/calls/g)).to.have.length(1);
    expect(graph).to.include('f0_e1 -. "calls" .-> f1_e0');
  });

  it('renders a recursive DOT subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
    });
    expect(graph).to.include('digraph Flow {');
    expect(graph.match(/label="calls"/g)).to.have.length(1);
  });

  it('includes variable and formula nodes only when requested', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: true,
      includeFormulas: true,
    });
    expect(graph).to.include('Variable: InputValue');
    expect(graph).to.include('Formula: Greeting = &quot;Hello&quot;');
    expect(graph.match(/defines/g)).to.have.length(2);
  });
});
