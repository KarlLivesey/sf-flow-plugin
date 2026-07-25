/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import type { FlowDescription } from '../../src/types/flow-inspection.js';
import {
  createRenderFlows,
  resolveGraphCurve,
  resolveGraphDirection,
  resolveGraphElkOptions,
  resolveGraphLayout,
} from '../../src/utils/flow-graph-renderer-model.js';
import { inspectionRequest, nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

function firstFlow(flows: ReadonlyArray<FlowDescription>): FlowDescription {
  const flow = flows[0];
  if (flow === undefined) {
    throw new Error('Expected a rendered Flow.');
  }
  return flow;
}

describe('renderFlowGraph automatic layout', (): void => {
  it('selects layout based on Flow structure in automatic mode', async (): Promise<void> => {
    const recursive = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    const single = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest({ recursive: false }));
    expect({
      recursiveDirection: resolveGraphDirection(recursive.flows, 'auto'),
      singleDirection: resolveGraphDirection(single.flows, 'auto'),
      directionOverride: resolveGraphDirection(recursive.flows, 'left-right'),
      recursiveLayout: resolveGraphLayout(recursive.flows, 'auto'),
      singleLayout: resolveGraphLayout(single.flows, 'auto'),
      overrideSelectsElk: resolveGraphLayout(single.flows, 'auto', {
        nodePlacement: 'network-simplex',
        modelOrder: 'auto',
        cycleBreaking: 'auto',
        mergeEdges: false,
        forceNodeOrder: false,
      }),
      layoutOverride: resolveGraphLayout(single.flows, 'elk'),
      candidateSelection: resolveGraphLayout(recursive.flows, ['dagre', 'elk']),
      restrictedCandidateSelection: resolveGraphLayout(recursive.flows, ['dagre']),
      elkCurve: resolveGraphCurve('auto', 'elk'),
      dagreCurve: resolveGraphCurve('auto', 'dagre'),
      curveOverride: resolveGraphCurve('step', 'elk'),
    }).to.deep.equal({
      recursiveDirection: 'top-down',
      singleDirection: 'left-right',
      directionOverride: 'left-right',
      recursiveLayout: 'elk',
      singleLayout: 'dagre',
      overrideSelectsElk: 'elk',
      layoutOverride: 'elk',
      candidateSelection: 'elk',
      restrictedCandidateSelection: 'dagre',
      elkCurve: 'linear',
      dagreCurve: 'basis',
      curveOverride: 'step',
    });
  });
});

describe('renderFlowGraph automatic ELK profile', (): void => {
  it('prioritises edges in a recursive acyclic graph', async (): Promise<void> => {
    const recursive = await new FlowDescribeService(nestedFlowGateway()).describe(inspectionRequest());
    expect(
      resolveGraphElkOptions(recursive.flows, {
        nodePlacement: 'auto',
        modelOrder: 'auto',
        cycleBreaking: 'auto',
        mergeEdges: false,
        forceNodeOrder: false,
      })
    ).to.deep.equal({
      nodePlacement: 'brandes-koepf',
      modelOrder: 'prefer-edges',
      cycleBreaking: 'greedy',
      mergeEdges: false,
      forceNodeOrder: false,
    });
  });
});

describe('renderFlowGraph cyclic and explicit ELK profiles', (): void => {
  it('uses ELK automatically for a cyclic Flow', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(
      inspectionRequest({ recursive: false })
    );
    const flow = firstFlow(described.flows);
    flow.connectors.push({ source: 'Call_Subflow', target: 'start', label: 'Next', kind: 'normal' });
    expect(resolveGraphLayout(described.flows, 'auto')).to.equal('elk');
    expect(
      resolveGraphElkOptions(described.flows, {
        nodePlacement: 'auto',
        modelOrder: 'auto',
        cycleBreaking: 'auto',
        mergeEdges: false,
        forceNodeOrder: false,
      })
    ).to.deep.equal({
      nodePlacement: 'network-simplex',
      modelOrder: 'prefer-edges',
      cycleBreaking: 'greedy-model-order',
      mergeEdges: false,
      forceNodeOrder: false,
    });
  });

  it('preserves explicit ELK overrides', (): void => {
    const requested = {
      nodePlacement: 'linear-segments',
      modelOrder: 'prefer-nodes',
      cycleBreaking: 'depth-first',
      mergeEdges: true,
      forceNodeOrder: true,
    } as const;
    expect(resolveGraphElkOptions([], requested)).to.deep.equal(requested);
  });
});

describe('renderFlowGraph model ordering', (): void => {
  it('emits connected elements in execution order', async (): Promise<void> => {
    const described = await new FlowDescribeService(nestedFlowGateway()).describe(
      inspectionRequest({ recursive: false })
    );
    const flow = firstFlow(described.flows);
    flow.elements.reverse();
    expect(createRenderFlows([flow])[0]?.elements.map((element) => element.name)).to.deep.equal([
      'start',
      'Call_Subflow',
    ]);
  });
});
