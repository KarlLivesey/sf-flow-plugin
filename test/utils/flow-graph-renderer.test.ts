/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import type { FlowGraphStyle } from '../../src/types/flow-inspection.js';
import { renderFlowGraph } from '../../src/utils/flow-graph-renderer.js';
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

const defaultStyle = {
  colors: {},
  fontFamily: 'Arial',
  fontSize: 14,
};

describe('renderFlowGraph defaults', (): void => {
  it('renders a recursive Mermaid subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
      style: defaultStyle,
    });
    expect(graph).to.include('%%{init:');
    expect(graph).to.include('flowchart TD');
    expect(graph.match(/calls/g)).to.have.length(1);
    expect(graph).to.include('f0_e1 -. "calls" .-> f1_e0');
    expect(graph).to.include('classDef flowDecision');
    expect(graph).to.include('stroke:#B45309');
  });

  it('renders a recursive DOT subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
      style: defaultStyle,
    });
    expect(graph).to.include('digraph Flow {');
    expect(graph.match(/label="calls"/g)).to.have.length(1);
    expect(graph).to.include('style="rounded,filled"');
    expect(graph).to.include('fontname="Arial"');
  });

  it('includes variable and formula nodes only when requested', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: true,
      includeFormulas: true,
      style: defaultStyle,
    });
    expect(graph).to.include('Variable: InputValue');
    expect(graph).to.include('Formula: Greeting = &quot;Hello&quot;');
    expect(graph.match(/defines/g)).to.have.length(2);
  });
});

describe('renderFlowGraph overrides', (): void => {
  it('converts named and hex overrides into matching Mermaid and DOT colours', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const style: FlowGraphStyle = {
      colors: {
        start: 'orange',
        subflow: '#7c3aed',
        connector: 'gray',
      },
      fontFamily: 'Fira Code',
      fontSize: 16,
    };
    const mermaid = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
      style,
    });
    const dot = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
      style,
    });
    for (const graph of [mermaid, dot]) {
      expect(graph).to.include('#FFA500');
      expect(graph).to.include('#7C3AED');
      expect(graph).to.include('#808080');
      expect(graph).to.include('Fira Code');
    }
  });
});
