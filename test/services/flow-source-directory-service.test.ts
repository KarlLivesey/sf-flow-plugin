/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect } from 'chai';

import { checkFlowSourceDirectory } from '../../src/services/flow-source-analysis-service.js';
import {
  inspectDirectLocalSubflows,
  loadFlowSourceDirectory,
  traverseLocalSubflows,
} from '../../src/services/flow-source-directory-service.js';
import type { FlowSource } from '../../src/types/flow-source.js';
import { formatFlowCheckSarif } from '../../src/utils/flow-check-analysis.js';
import { flowCheckSourceFile } from '../../src/utils/flow-check-source-file.js';

function source(apiName: string, subflowNames: string[] = [], namespace: string | null = null): FlowSource {
  const qualifiedName = namespace === null ? apiName : `${namespace}__${apiName}`;
  return {
    apiName,
    namespace,
    sourceFile: `/${qualifiedName}.flow-meta.xml`,
    metadata: {},
    description: {
      apiName,
      namespace,
      qualifiedName,
      definitionId: null,
      versionId: null,
      versionNumber: null,
      status: 'Draft',
      label: apiName,
      processType: 'AutoLaunchedFlow',
      depth: 0,
      variables: [],
      formulas: [],
      apexActions: [],
      subflows: subflowNames.map((flowName) => ({ name: `Call_${flowName}`, label: null, flowName })),
      referencedObjects: [],
      elements: [],
      connectors: [],
    },
  };
}

describe('local Flow source directory traversal', (): void => {
  it('resolves recursive local subflows once', (): void => {
    const root = source('Root', ['Child']);
    const child = source('Child', ['Leaf']);
    const leaf = source('Leaf');
    const result = traverseLocalSubflows(root, [root, child, leaf], 5);
    expect(result.sources.map((item) => item.apiName)).to.deep.equal(['Root', 'Child', 'Leaf']);
    expect(result.warnings).to.deep.equal([]);
  });

  it('reports missing subflows and depth limits', (): void => {
    const root = source('Root', ['Child']);
    const child = source('Child', ['Missing']);
    const result = traverseLocalSubflows(root, [root, child], 0);
    expect(result.warnings).to.deep.equal([{ kind: 'depth-limit', flowName: 'Child', path: ['Root', 'Child'] }]);
  });

  it('validates direct references without treating non-recursive traversal as a depth limit', (): void => {
    const root = source('Root', ['Child']);
    const child = source('Child', ['MissingBelowChild']);
    expect(inspectDirectLocalSubflows(root, [root, child])).to.deep.equal([]);
    expect(inspectDirectLocalSubflows(source('MissingRoot', ['Missing']), [])).to.deep.equal([
      {
        kind: 'missing-subflow',
        flowName: 'Missing',
        path: ['MissingRoot', 'Missing'],
      },
    ]);
  });
});

describe('local Flow source directory breadth-first traversal', (): void => {
  it('uses the shortest path when the same Flow is reached through different branches', (): void => {
    const root = source('Root', ['Long', 'Short']);
    const long = source('Long', ['Middle']);
    const short = source('Short', ['Target']);
    const middle = source('Middle', ['Target']);
    const target = source('Target');
    const result = traverseLocalSubflows(root, [root, long, short, middle, target], 2);
    expect(result.sources.map((item) => item.apiName)).to.deep.equal(['Root', 'Long', 'Short', 'Middle', 'Target']);
    expect(result.warnings).to.deep.equal([]);
  });

  it('resolves unqualified references in the caller namespace and qualified references exactly', (): void => {
    const managedRoot = source('Root', ['Child', 'other__Child'], 'managed');
    const managedChild = source('Child', [], 'managed');
    const unmanagedChild = source('Child');
    const otherChild = source('Child', [], 'other');
    const result = traverseLocalSubflows(managedRoot, [managedRoot, managedChild, unmanagedChild, otherChild], 1);
    expect(result.sources.map((item) => item.description.qualifiedName)).to.deep.equal([
      'managed__Root',
      'managed__Child',
      'other__Child',
    ]);
    expect(result.warnings).to.deep.equal([]);
  });

  it('uses the recursive traversal for directory metrics', (): void => {
    const root = source('Root', ['Child']);
    const child = source('Child');
    const result = checkFlowSourceDirectory(
      { directory: '/flows', sources: [root, child] },
      {
        checks: ['metrics'],
        excluded: [],
        lintFindings: [],
        recursive: true,
        maxDepth: 4,
      }
    );
    expect(result.flows[0]?.metrics).to.include({ recursive: true, maxDepth: 4 });
    expect(result.flows[0]?.metrics?.flows.map((flow) => flow.apiName)).to.deep.equal(['Root', 'Child']);
    expect(result.flows[0]?.metrics?.warnings).to.deep.equal([]);
  });
});

describe('local Flow source directory SARIF locations', (): void => {
  it('attaches subflow findings to the caller source file in SARIF output', (): void => {
    const root = source('Root', ['Missing']);
    const result = checkFlowSourceDirectory(
      { directory: '/flows', sources: [root] },
      {
        checks: ['subflows'],
        excluded: [],
        lintFindings: [],
        recursive: true,
        maxDepth: 4,
      }
    );

    expect(result.findings[0] === undefined ? undefined : flowCheckSourceFile(result.findings[0])).to.equal(
      root.sourceFile
    );
    expect(formatFlowCheckSarif(result)).to.contain(pathToFileURL(root.sourceFile).toString());
  });
});

describe('local Flow source directory discovery', (): void => {
  it('fails as soon as the directory contains more than 2,000 Flow files', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-directory-limit-'));
    try {
      await Promise.all(
        Array.from({ length: 2001 }, async (_, index) =>
          writeFile(join(directory, `Flow_${String(index).padStart(4, '0')}.flow-meta.xml`), '', 'utf8')
        )
      );
      try {
        await loadFlowSourceDirectory(directory);
        expect.fail('Expected FlowSourceInvalid.');
      } catch (error: unknown) {
        expect(error).to.have.property('name', 'FlowSourceInvalid');
        expect(error).to.have.property('message').that.includes('more than 2000');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
