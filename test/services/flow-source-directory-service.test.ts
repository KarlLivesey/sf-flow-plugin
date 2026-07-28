/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { inspectDirectLocalSubflows, traverseLocalSubflows } from '../../src/services/flow-source-directory-service.js';
import type { FlowSource } from '../../src/types/flow-source.js';

function source(apiName: string, subflowNames: string[] = []): FlowSource {
  return {
    apiName,
    namespace: null,
    sourceFile: `/${apiName}.flow-meta.xml`,
    metadata: {},
    description: {
      apiName,
      namespace: null,
      qualifiedName: apiName,
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
