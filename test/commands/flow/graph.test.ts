/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowGraph, { type GraphFlagValues } from '../../../src/commands/flow/graph.js';
import { FlowGraphService } from '../../../src/services/flow-graph-service.js';
import type { FlowGraphResult } from '../../../src/types/flow-inspection.js';
import { parseGraphColorOverrides, writeGraphOutput } from '../../../src/utils/flow-graph-command.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowGraphResult = {
  apiName: 'Order_Processing',
  namespace: null,
  requestedVersion: 'latest',
  resolvedVersion: 2,
  subflowVersion: 'latest',
  recursive: true,
  maxDepth: 4,
  flows: [],
  warnings: [],
  targetOrg: 'admin@example.com',
  format: 'dot',
  includeVariables: true,
  includeFormulas: true,
  requestedDirection: 'left-right',
  resolvedDirection: 'left-right',
  requestedLayout: 'elk',
  layoutCandidates: ['elk'],
  resolvedLayout: 'elk',
  requestedCurve: 'step-after',
  resolvedCurve: 'step-after',
  requestedElk: {
    nodePlacement: 'network-simplex',
    modelOrder: 'prefer-edges',
    cycleBreaking: 'greedy-model-order',
    mergeEdges: true,
    forceNodeOrder: true,
  },
  resolvedElk: {
    nodePlacement: 'network-simplex',
    modelOrder: 'prefer-edges',
    cycleBreaking: 'greedy-model-order',
    mergeEdges: true,
    forceNodeOrder: true,
  },
  nodeSpacing: 42,
  rankSpacing: 56,
  legend: true,
  labelWidth: 36,
  style: {
    colors: { decision: 'orange' },
    fontFamily: 'Inter',
    fontSize: 16,
  },
  graph: 'digraph Flow {}',
};

function graphFlags(): GraphFlagValues {
  return {
    'api-name': 'Order_Processing',
    'target-org': createCommandOrg({} as Connection),
    version: 3,
    'subflow-version': 'latest',
    format: 'dot',
    recursive: true,
    'max-depth': 4,
    'include-variables': true,
    'include-formulas': true,
    direction: 'left-right',
    layout: ['elk'],
    curve: 'step-after',
    'node-placement': 'network-simplex',
    'model-order': 'prefer-edges',
    'cycle-breaking': 'greedy-model-order',
    'merge-edges': true,
    'force-node-order': true,
    'node-spacing': 42,
    'rank-spacing': 56,
    legend: true,
    'label-width': 36,
    color: ['decision=orange'],
    'font-family': 'Inter',
    'font-size': 16,
    'output-file': undefined,
    namespace: undefined,
    'api-version': undefined,
  };
}

describe('flow graph flags', (): void => {
  it('defaults to Mermaid without resource annotations or recursion', (): void => {
    expect({
      format: FlowGraph.flags.format.default,
      subflowVersion: FlowGraph.flags['subflow-version'].default,
      recursive: FlowGraph.flags.recursive.default,
      includeVariables: FlowGraph.flags['include-variables'].default,
      includeFormulas: FlowGraph.flags['include-formulas'].default,
      direction: FlowGraph.flags.direction.default,
      layout: FlowGraph.flags.layout.default,
      curve: FlowGraph.flags.curve.default,
      nodePlacement: FlowGraph.flags['node-placement'].default,
      modelOrder: FlowGraph.flags['model-order'].default,
      cycleBreaking: FlowGraph.flags['cycle-breaking'].default,
      mergeEdges: FlowGraph.flags['merge-edges'].default,
      forceNodeOrder: FlowGraph.flags['force-node-order'].default,
      nodeSpacing: FlowGraph.flags['node-spacing'].default,
      rankSpacing: FlowGraph.flags['rank-spacing'].default,
      legend: FlowGraph.flags.legend.default,
      labelWidth: FlowGraph.flags['label-width'].default,
    }).to.deep.equal({
      format: 'mermaid',
      subflowVersion: 'active',
      recursive: false,
      includeVariables: false,
      includeFormulas: false,
      direction: 'auto',
      layout: ['auto'],
      curve: 'auto',
      nodePlacement: 'auto',
      modelOrder: 'auto',
      cycleBreaking: 'auto',
      mergeEdges: false,
      forceNodeOrder: false,
      nodeSpacing: 35,
      rankSpacing: 45,
      legend: false,
      labelWidth: 32,
    });
  });
});

describe('flow graph styling flags', (): void => {
  it('defaults graph styling and file output safely', (): void => {
    expect(FlowGraph.flags.color.default).to.deep.equal([]);
    expect(FlowGraph.flags.color.aliases).to.deep.equal(['colour']);
    expect(FlowGraph.flags['font-family'].default).to.equal('Arial');
    expect(FlowGraph.flags['font-size'].default).to.equal(14);
    expect(FlowGraph.flags['output-file'].required).to.not.equal(true);
    expect(FlowGraph.flags.layout.multiple).to.equal(true);
    expect(FlowGraph.flags['merge-edges'].allowNo).to.equal(true);
    expect(FlowGraph.flags['force-node-order'].allowNo).to.equal(true);
  });

  it('accepts named and hex colour overrides with the last duplicate winning', (): void => {
    expect(
      parseGraphColorOverrides(['decision=orange', 'subflow=#7c3aed', 'fault=crimson', 'decision=coral'])
    ).to.deep.equal({
      decision: 'coral',
      subflow: '#7c3aed',
      fault: 'crimson',
    });
  });

  it('rejects malformed or unsupported colour overrides', (): void => {
    expect(() => parseGraphColorOverrides(['decision=chartreuse'])).to.throw(
      'must use a supported ROLE=COLOUR or ROLE=#HEX value'
    );
  });
});

describe('flow graph command execution', (): void => {
  it('passes graph and recursive traversal options to the service', async (): Promise<void> => {
    const flags = graphFlags();
    $$.SANDBOX.stub(FlowGraph.prototype, 'parseFlags').resolves(flags);
    const graph = $$.SANDBOX.stub(FlowGraphService.prototype, 'graph').resolves(result);
    const actual = await FlowGraph.run(['--json']);
    expect(graph.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      version: 3,
      subflowVersion: 'latest',
      format: 'dot',
      recursive: true,
      maxDepth: 4,
      includeVariables: true,
      includeFormulas: true,
      direction: 'left-right',
      layout: ['elk'],
      curve: 'step-after',
      elk: {
        nodePlacement: 'network-simplex',
        modelOrder: 'prefer-edges',
        cycleBreaking: 'greedy-model-order',
        mergeEdges: true,
        forceNodeOrder: true,
      },
      nodeSpacing: 42,
      rankSpacing: 56,
      legend: true,
      labelWidth: 36,
      style: {
        colors: { decision: 'orange' },
        fontFamily: 'Inter',
        fontSize: 16,
      },
    });
    expect(actual).to.equal(result);
  });
});

describe('flow graph file output', (): void => {
  let temporaryDirectory: string;

  beforeEach(async (): Promise<void> => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-graph-'));
  });

  afterEach(async (): Promise<void> => {
    await rm(temporaryDirectory, { recursive: true });
  });

  it('creates a graph source file', async (): Promise<void> => {
    const outputFile = join(temporaryDirectory, 'flow.mmd');
    await writeGraphOutput(outputFile, 'flowchart TD\n');
    expect(await readFile(outputFile, 'utf8')).to.equal('flowchart TD\n');
  });

  it('refuses to overwrite an existing file', async (): Promise<void> => {
    const outputFile = join(temporaryDirectory, 'flow.dot');
    await writeFile(outputFile, 'existing');
    try {
      await writeGraphOutput(outputFile, 'replacement');
      expect.fail('Expected graph output to reject an existing file.');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).message).to.include('already exists');
    }
    expect(await readFile(outputFile, 'utf8')).to.equal('existing');
  });
});
