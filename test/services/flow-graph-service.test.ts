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
    layout: 'auto',
    curve: 'auto',
    elk: {
      nodePlacement: 'auto',
      modelOrder: 'auto',
      cycleBreaking: 'auto',
      mergeEdges: false,
      forceNodeOrder: false,
    },
    nodeSpacing: 35,
    rankSpacing: 45,
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
    expect(result).to.deep.include({
      requestedDirection: 'auto',
      resolvedDirection: 'left-right',
      requestedLayout: 'auto',
      layoutCandidates: ['dagre', 'elk'],
      resolvedLayout: 'dagre',
      requestedCurve: 'auto',
      resolvedCurve: 'basis',
      requestedElk: {
        nodePlacement: 'auto',
        modelOrder: 'auto',
        cycleBreaking: 'auto',
        mergeEdges: false,
        forceNodeOrder: false,
      },
      resolvedElk: {
        nodePlacement: 'brandes-koepf',
        modelOrder: 'nodes-and-edges',
        cycleBreaking: 'greedy',
        mergeEdges: false,
        forceNodeOrder: false,
      },
      nodeSpacing: 35,
      rankSpacing: 45,
      legend: true,
      labelWidth: 24,
    });
    expect(result.graph).to.include('flowchart LR');
    expect(result.graph).to.include('subgraph flowLegend["Legend"]');
  });
});
