/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowGraph from '../../../src/commands/flow/graph.js';
import { FlowGraphService } from '../../../src/services/flow-graph-service.js';
import type { FlowGraphResult } from '../../../src/types/flow-inspection.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowGraphResult = {
  apiName: 'Order_Processing',
  namespace: null,
  requestedVersion: 'latest',
  resolvedVersion: 2,
  recursive: true,
  maxDepth: 4,
  flows: [],
  warnings: [],
  targetOrg: 'admin@example.com',
  format: 'dot',
  includeVariables: true,
  includeFormulas: true,
  graph: 'digraph Flow {}',
};

describe('flow graph flags', (): void => {
  it('defaults to Mermaid without resource annotations or recursion', (): void => {
    expect(FlowGraph.flags.format.default).to.equal('mermaid');
    expect(FlowGraph.flags.recursive.default).to.equal(false);
    expect(FlowGraph.flags['include-variables'].default).to.equal(false);
    expect(FlowGraph.flags['include-formulas'].default).to.equal(false);
  });
});

describe('flow graph command execution', (): void => {
  it('passes graph and recursive traversal options to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      version: 3 as const,
      format: 'dot' as const,
      recursive: true,
      'max-depth': 4,
      'include-variables': true,
      'include-formulas': true,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowGraph.prototype, 'parseFlags').resolves(flags);
    const graph = $$.SANDBOX.stub(FlowGraphService.prototype, 'graph').resolves(result);
    const actual = await FlowGraph.run(['--json']);
    expect(graph.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      version: 3,
      format: 'dot',
      recursive: true,
      maxDepth: 4,
      includeVariables: true,
      includeFormulas: true,
    });
    expect(actual).to.equal(result);
  });
});
