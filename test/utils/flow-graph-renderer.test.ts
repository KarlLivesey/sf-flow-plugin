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
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

const defaultStyle = {
  colors: {},
  fontFamily: 'Arial',
  fontSize: 14,
};

const defaultRouting = {
  elk: {
    nodePlacement: 'brandes-koepf',
    modelOrder: 'nodes-and-edges',
    cycleBreaking: 'greedy',
    mergeEdges: false,
    forceNodeOrder: false,
  },
  nodeSpacing: 35,
  rankSpacing: 45,
} as const;

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
      ...defaultRouting,
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      layout: 'dagre',
      curve: 'step',
      legend: false,
      labelWidth: 32,
      style: defaultStyle,
    });
    expect(graph).to.include('%%{init:');
    expect(graph).to.include('flowchart TD');
    expect(graph.match(/calls/g)).to.have.length(1);
    expect(graph).to.include('f0_e1 -. "calls" .-> f1');
    expect(graph).to.include('classDef flowDecision');
    expect(graph).to.include('stroke:#B45309');
  });

  it('renders a recursive DOT subflow call', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'dot', {
      ...defaultRouting,
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      layout: 'dagre',
      curve: 'step',
      legend: false,
      labelWidth: 32,
      style: defaultStyle,
    });
    expect(graph).to.include('digraph Flow {');
    expect(graph.match(/label="calls"/g)).to.have.length(1);
    expect(graph).to.include('style="rounded,filled"');
    expect(graph).to.include('fontname="Arial"');
    expect(graph).to.include('lhead="cluster_f1"');
  });
});

describe('renderFlowGraph resource annotations', (): void => {
  it('includes variable and formula nodes only when requested', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const graph = renderFlowGraph(described.flows, 'mermaid', {
      ...defaultRouting,
      includeVariables: true,
      includeFormulas: true,
      direction: 'top-down',
      layout: 'dagre',
      curve: 'step',
      legend: false,
      labelWidth: 32,
      style: defaultStyle,
    });
    expect(graph).to.include('Variable: InputValue');
    expect(graph).to.include('Formula: Greeting =');
    expect(graph).to.include('&quot;Hello&quot;');
    expect(graph).to.include('subgraph f0_resources["Resources"]');
    expect(graph).not.to.include('defines');
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
      ...defaultRouting,
      elk: {
        nodePlacement: 'network-simplex',
        modelOrder: 'prefer-edges',
        cycleBreaking: 'greedy-model-order',
        mergeEdges: true,
        forceNodeOrder: true,
      },
      includeVariables: false,
      includeFormulas: false,
      direction: 'left-right',
      layout: 'elk',
      curve: 'step-after',
      legend: true,
      labelWidth: 12,
      style: defaultStyle,
    });
    expect(graph)
      .to.include('flowchart LR')
      .and.include('"layout":"elk"')
      .and.include('"curve":"stepAfter"')
      .and.include('"nodePlacementStrategy":"NETWORK_SIMPLEX"')
      .and.include('"considerModelOrder":"PREFER_EDGES"')
      .and.include('"cycleBreakingStrategy":"GREEDY_MODEL_ORDER"')
      .and.include('"mergeEdges":true')
      .and.include('"forceNodeModelOrder":true')
      .and.include('"nodeSpacing":35')
      .and.include('"rankSpacing":45');
    expect(graph).to.include('subgraph flowLegend["Legend"]');
    expect(graph).to.include('Subflow:<br/>Call Flow_B');
    expect(graph).to.include('stroke:#FF0000');
    expect(graph).to.include('stroke-dasharray:5 3');
  });
});

describe('renderFlowGraph DOT semantic presentation', (): void => {
  it('renders matching DOT layout, connector semantics and a legend', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const root = firstFlow(described.flows);
    root.connectors = [{ source: 'start', target: 'Call_Subflow', label: 'Failure', kind: 'fault' }];
    const graph = renderFlowGraph(described.flows, 'dot', {
      ...defaultRouting,
      nodeSpacing: 36,
      rankSpacing: 54,
      includeVariables: false,
      includeFormulas: false,
      direction: 'left-right',
      layout: 'dagre',
      curve: 'step',
      legend: true,
      labelWidth: 12,
      style: defaultStyle,
    });
    expect(graph).to.include('rankdir=LR');
    expect(graph).to.include('subgraph cluster_legend');
    expect(graph).to.include('color="#FF0000"');
    expect(graph).to.include('style="dashed"');
    expect(graph).to.include('nodesep=0.5');
    expect(graph).to.include('ranksep=0.75');
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
      ...defaultRouting,
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      layout: 'dagre',
      curve: 'step',
      legend: false,
      labelWidth: 32,
      style,
    });
    const dot = renderFlowGraph(described.flows, 'dot', {
      ...defaultRouting,
      includeVariables: false,
      includeFormulas: false,
      direction: 'top-down',
      layout: 'dagre',
      curve: 'step',
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
