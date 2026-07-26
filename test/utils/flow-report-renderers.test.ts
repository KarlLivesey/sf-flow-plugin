/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { renderFlowComparison } from '../../src/utils/flow-comparison-renderer.js';
import { renderFlowDependencies } from '../../src/utils/flow-dependencies-renderer.js';
import { writeFlowReport } from '../../src/utils/flow-report-file.js';
import type { FlowCompareResult, FlowDependenciesResult } from '../../src/types/flow-analysis.js';

const comparison: FlowCompareResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: 'definition',
  fromDefinitionId: 'definition',
  toDefinitionId: 'definition',
  requestedFrom: 1,
  requestedTo: 2,
  scopes: [],
  ignoreOrder: false,
  ignorePaths: [],
  fromVersion: 1,
  toVersion: 2,
  changes: [{ kind: 'changed', path: '$.label', before: 'One|A', after: { value: 'Two' } }],
  added: 0,
  removed: 0,
  changed: 1,
  different: true,
  targetOrg: 'admin@example.com',
  fromOrg: 'admin@example.com',
  toOrg: 'admin@example.com',
  crossOrg: false,
};

const dependencies: FlowDependenciesResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: 'definition',
  direction: 'both',
  recursive: false,
  maxDepth: 10,
  types: [],
  excludeTypes: [],
  definitionsScanned: 1,
  dependencies: [
    {
      sourceDefinitionId: 'definition',
      sourceApiName: 'Order_Processing',
      sourceNamespace: null,
      depth: 0,
      direction: 'uses',
      componentId: 'object',
      name: 'Account',
      namespace: null,
      type: 'CustomObject',
    },
    {
      sourceDefinitionId: 'definition',
      sourceApiName: 'Order_Processing',
      sourceNamespace: 'example',
      depth: 1,
      direction: 'used-by',
      componentId: null,
      name: null,
      namespace: 'example',
      type: null,
    },
  ],
  truncated: false,
  truncations: [],
  targetOrg: 'admin@example.com',
};

function recursiveDependencies(): FlowDependenciesResult {
  const base = dependencies.dependencies[0];
  if (base === undefined) {
    throw new Error('Expected a dependency fixture.');
  }
  return {
    ...dependencies,
    recursive: true,
    dependencies: [
      { ...base, sourceApiName: 'Flow_A', name: 'Flow_B', componentId: 'flow-b', type: 'Flow' },
      {
        ...base,
        sourceDefinitionId: 'flow-b',
        sourceApiName: 'Flow_B',
        depth: 1,
        name: 'Handler',
        componentId: 'handler',
        type: 'ApexClass',
      },
    ],
  };
}

describe('Flow report renderers', (): void => {
  for (const format of ['summary', 'unified', 'markdown'] as const) {
    it(`renders comparison ${format} output`, (): void => {
      expect(renderFlowComparison(comparison, format)).to.contain('Order_Processing');
    });
  }

  for (const format of ['table', 'tree', 'mermaid', 'dot'] as const) {
    it(`renders dependency ${format} output`, (): void => {
      expect(renderFlowDependencies(dependencies, format)).to.contain('Order_Processing');
    });
  }

  it('creates parent directories and terminates report files with a newline', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-report-'));
    const output = join(directory, 'nested', 'report.txt');
    try {
      expect(await writeFlowReport(output, 'report')).to.equal(output);
      expect(await readFile(output, 'utf8')).to.equal('report\n');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe('Flow dependency renderer structure', (): void => {
  it('identifies the source Flow on every tree edge', (): void => {
    const tree = renderFlowDependencies(dependencies, 'tree');
    expect(tree).to.contain('[depth 0] Order_Processing uses -> CustomObject:Account');
    expect(tree).to.contain('[depth 1] example__Order_Processing <- used by Unknown:example__unknown');
  });

  it('allocates distinct Mermaid IDs for labels with the same legacy hash', (): void => {
    const base = dependencies.dependencies[0];
    if (base === undefined) {
      throw new Error('Expected a dependency fixture.');
    }
    const colliding: FlowDependenciesResult = {
      ...dependencies,
      dependencies: [
        { ...base, name: 'Aa' },
        { ...base, componentId: 'second', name: 'BB' },
      ],
    };
    const mermaid = renderFlowDependencies(colliding, 'mermaid');
    const first = /(\w+)\["CustomObject:Aa"\]/u.exec(mermaid);
    const second = /(\w+)\["CustomObject:BB"\]/u.exec(mermaid);
    expect(first?.[1]).to.match(/^n\d+$/u);
    expect(second?.[1]).to.match(/^n\d+$/u);
    expect(first?.[1]).not.to.equal(second?.[1]);
  });
});

describe('Flow dependency renderer recursion', (): void => {
  it('uses one Flow node across recursive Mermaid and DOT edges', (): void => {
    const recursive = recursiveDependencies();
    const mermaid = renderFlowDependencies(recursive, 'mermaid');
    const recursiveNode = /(\w+)\["Flow:Flow_B"\]/u.exec(mermaid)?.[1];
    expect(recursiveNode).to.match(/^n\d+$/u);
    expect(mermaid.match(new RegExp(`${recursiveNode ?? 'missing'}\\["Flow:Flow_B"\\]`, 'gu'))).to.have.length(2);
    const dot = renderFlowDependencies(recursive, 'dot');
    expect(dot).to.contain('"Flow:Flow_A" -> "Flow:Flow_B";');
    expect(dot).to.contain('"Flow:Flow_B" -> "ApexClass:Handler";');
  });
});
