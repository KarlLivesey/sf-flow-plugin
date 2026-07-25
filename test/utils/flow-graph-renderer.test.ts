/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import type { FlowDescription, FlowGraphStyle } from '../../src/types/flow-inspection.js';
import { renderFlowGraph } from '../../src/utils/flow-graph-renderer.js';
import { resolveGraphDirection } from '../../src/utils/flow-graph-renderer-model.js';
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

const defaultStyle = {
  colors: {},
  fontFamily: 'Arial',
  fontSize: 14,
};

function firstFlow(flows: ReadonlyArray<FlowDescription>): FlowDescription {
  const flow = flows[0];
  if (flow === undefined) {
    throw new Error('Expected a rendered Flow.');
  }
  return flow;
}

describe('renderFlowGraph defaults', (): void => {
  it('renders a recursive Mermaid subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      legend: false,
      labelWidth: 32,
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
      direction: 'top-down',
      legend: false,
      labelWidth: 32,
      style: defaultStyle,
    });
    expect(graph).to.include('digraph Flow {');
    expect(graph.match(/label="calls"/g)).to.have.length(1);
    expect(graph).to.include('style="rounded,filled"');
    expect(graph).to.include('fontname="Arial"');
  });
});

describe('renderFlowGraph layout and annotations', (): void => {
  it('includes variable and formula nodes only when requested', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: true,
      includeFormulas: true,
      direction: 'top-down',
      legend: false,
      labelWidth: 32,
      style: defaultStyle,
    });
    expect(graph).to.include('Variable: InputValue');
    expect(graph).to.include('Formula: Greeting =');
    expect(graph).to.include('&quot;Hello&quot;');
    expect(graph.match(/defines/g)).to.have.length(2);
  });

  it('selects layout based on Flow structure in automatic mode', async (): Promise<void> => {
    const recursive = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const single = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest({ recursive: false }));
    expect(resolveGraphDirection(recursive.flows, 'auto')).to.equal('top-down');
    expect(resolveGraphDirection(single.flows, 'auto')).to.equal('left-right');
    expect(resolveGraphDirection(recursive.flows, 'left-right')).to.equal('left-right');
  });
});

describe('renderFlowGraph semantic presentation', (): void => {
  it('renders Mermaid layout, connector semantics, wrapping and a legend', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const root = firstFlow(described.flows);
    root.connectors = [
      { source: 'start', target: 'Call_Subflow', label: 'Accepted', kind: 'outcome' },
      { source: 'start', target: 'Call_Subflow', label: 'Otherwise', kind: 'default' },
      { source: 'start', target: 'Call_Subflow', label: 'Failure', kind: 'fault' },
    ];
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      includeVariables: false,
      includeFormulas: false,
      direction: 'left-right',
      legend: true,
      labelWidth: 12,
      style: defaultStyle,
    });
    expect(graph).to.include('flowchart LR');
    expect(graph).to.include('subgraph flowLegend["Legend"]');
    expect(graph).to.include('Subflow:<br/>Call Flow_B');
    expect(graph).to.include('stroke:#FF0000');
    expect(graph).to.include('stroke-dasharray:5 3');
  });

  it('renders matching DOT layout, connector semantics and a legend', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const root = firstFlow(described.flows);
    root.connectors = [{ source: 'start', target: 'Call_Subflow', label: 'Failure', kind: 'fault' }];
    const graph = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
      direction: 'left-right',
      legend: true,
      labelWidth: 12,
      style: defaultStyle,
    });
    expect(graph).to.include('rankdir=LR');
    expect(graph).to.include('subgraph cluster_legend');
    expect(graph).to.include('color="#FF0000"');
    expect(graph).to.include('style="dashed"');
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
      direction: 'top-down',
      legend: false,
      labelWidth: 32,
      style,
    });
    const dot = renderFlowGraph(described.flows, 'dot', {
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      legend: false,
      labelWidth: 32,
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
