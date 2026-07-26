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
