/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { FlowDescribeService } from '../../src/services/flow-describe-service.js';
import type { FlowDescription, FlowGraphFormat } from '../../src/types/flow-inspection.js';
import { renderFlowGraph } from '../../src/utils/flow-graph-renderer.js';
import { createRenderFlows, type FlowGraphRenderOptions } from '../../src/utils/flow-graph-renderer-model.js';
import { documentFixture } from '../helpers/flow-document-fixtures.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';
import { inspectionRequest } from '../helpers/flow-inspection-fixtures.js';

const definitions = [
  { apiName: 'Root', namespace: null, calls: ['Parent', 'pkg__Parent', 'Missing'] },
  { apiName: 'Parent', namespace: null, calls: ['Child'] },
  { apiName: 'Child', namespace: null, calls: ['Child', 'Root', 'pkg__Child'] },
  { apiName: 'Parent', namespace: 'pkg', calls: ['Child', 'Child', 'other__Parent', 'Missing'] },
  { apiName: 'Child', namespace: 'pkg', calls: ['Child', 'Parent'] },
  { apiName: 'Parent', namespace: 'other', calls: ['Child', 'pkg__Child'] },
  { apiName: 'Child', namespace: 'other', calls: ['pkg__Child', 'Child'] },
  { apiName: 'Missing', namespace: null, calls: [] },
];

type CallEdge = [string, string, string];
const commonEdges: CallEdge[] = [
  ['Root', 'Call_0', 'Parent'],
  ['Root', 'Call_1', 'pkg__Parent'],
  ['Root', 'Call_2', 'Missing'],
  ['Parent', 'Call_0', 'Child'],
  ['Child', 'Call_0', 'Child'],
  ['Child', 'Call_1', 'Root'],
  ['Child', 'Call_2', 'pkg__Child'],
  ['pkg__Parent', 'Call_0', 'pkg__Child'],
  ['pkg__Parent', 'Call_1', 'pkg__Child'],
  ['pkg__Parent', 'Call_2', 'other__Parent'],
  ['pkg__Child', 'Call_0', 'pkg__Child'],
  ['pkg__Child', 'Call_1', 'pkg__Parent'],
  ['other__Parent', 'Call_1', 'pkg__Child'],
];
const expandedEdges: CallEdge[] = [
  ['other__Parent', 'Call_0', 'other__Child'],
  ['other__Child', 'Call_0', 'pkg__Child'],
  ['other__Child', 'Call_1', 'other__Child'],
];

const options: FlowGraphRenderOptions = {
  includeVariables: false,
  includeFormulas: false,
  direction: 'top-down',
  layout: 'dagre',
  curve: 'step',
  elk: {
    nodePlacement: 'brandes-koepf',
    modelOrder: 'nodes-and-edges',
    cycleBreaking: 'greedy',
    mergeEdges: false,
    forceNodeOrder: false,
  },
  nodeSpacing: 35,
  rankSpacing: 45,
  legend: false,
  labelWidth: 32,
  style: { colors: {}, fontFamily: 'Arial', fontSize: 14 },
};

function graphGateway(): FakeFlowGateway {
  const versions = definitions.map((_, index) => flowVersion('300000000000' + String(index + 1) + '01', 1, 'Active'));
  const gateway = new FakeFlowGateway(
    definitions.map((item, index) => ({
      ...flowDefinition({
        id: required(versions[index]).definitionId,
        apiName: item.apiName,
        activeVersionId: required(versions[index]).id,
        latestVersionId: required(versions[index]).id,
      }),
      namespace: item.namespace,
    })),
    versions
  );
  definitions.forEach((item, index) => {
    gateway.metadata.set(
      required(versions[index]).id,
      documentFixture(
        {
          start: {},
          subflows: item.calls.map((flowName, call) => ({ name: 'Call_' + String(call), flowName })),
        },
        item.namespace
      ).metadata
    );
  });
  return gateway;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Missing graph fixture identity.');
  }
  return value;
}

function assertArrows(flows: FlowDescription[], format: FlowGraphFormat, expected: CallEdge[]): void {
  const before = JSON.stringify(flows);
  const graph = renderFlowGraph(flows, format, options);
  const rendered = new Map(createRenderFlows(flows).map((flow) => [flow.description.qualifiedName, flow]));
  expected.forEach(([caller, call, target]) => {
    const from = required(rendered.get(caller));
    const to = required(rendered.get(target));
    const source = required(from.elementIds.get(call));
    const arrow =
      format === 'mermaid'
        ? source + ' -. "calls" .-> f' + String(to.index)
        : source + ' -> ' + required(to.elementIds.get('start')) + ' [';
    expect(graph, caller + ' ' + call + ' -> ' + target).to.include(arrow);
  });
  expect(graph.split('\n').filter((line) => line.includes('"calls"'))).to.have.length(expected.length);
  expect(JSON.stringify(flows)).to.equal(before);
}

describe('Namespace-exact graph call destinations', (): void => {
  for (const format of ['mermaid', 'dot'] as const) {
    it('retains exact repeated, shared, explicit and cyclic arrows in ' + format, async (): Promise<void> => {
      const result = await new FlowDescribeService(graphGateway()).describe(inspectionRequest({ apiName: 'Root' }));
      assertArrows(result.flows, format, [...commonEdges, ...expandedEdges]);
      expect(result.warnings.some((warning) => warning.kind === 'missing-subflow')).to.equal(true);
    });

    it('draws known depth-boundary targets but never substitutes namesakes in ' + format, async (): Promise<void> => {
      const result = await new FlowDescribeService(graphGateway()).describe(
        inspectionRequest({
          apiName: 'Root',
          maxDepth: 2,
        })
      );
      assertArrows(result.flows, format, commonEdges);
      expect(result.flows.some((flow) => flow.qualifiedName === 'other__Child')).to.equal(false);
    });
  }
});
