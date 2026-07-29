/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { checkFlowSourceDirectory } from '../../src/services/flow-source-analysis-service.js';
import { inspectDirectLocalSubflows, traverseLocalSubflows } from '../../src/services/flow-source-directory-service.js';
import type { FlowSource } from '../../src/types/flow-source.js';

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
