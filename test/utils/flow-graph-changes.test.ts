/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { changedGraphRoot, styleGraphChanges } from '../../src/utils/flow-graph-changes.js';
import { documentFixture } from '../helpers/flow-document-fixtures.js';

describe('Flow graph change overlays', (): void => {
  it('detects internal element changes and retains removed nodes with labelled edges', (): void => {
    const before = documentFixture({
      assignments: [{ name: 'Set', assignmentItems: [{ value: { numberValue: 1 } }] }],
      recordCreates: [{ name: 'Old', object: 'Account', connector: { targetReference: 'Set' } }],
    });
    const after = documentFixture({
      assignments: [{ name: 'Set', assignmentItems: [{ value: { numberValue: 2 } }] }],
      recordCreates: [{ name: 'New', object: 'Contact' }],
    });
    const result = changedGraphRoot(before, after);
    expect(result.highlights.map((change) => [change.element, change.kind])).to.have.deep.members([
      ['Set', 'changed'],
      ['Old', 'removed'],
      ['New', 'added'],
    ]);
    expect(result.flow.elements.find((element) => element.name === 'Old')?.label).to.include('[removed]');
    expect(result.flow.connectors[0]?.label).to.include('[removed]');
  });

  it('rejects different namespaces', (): void => {
    expect(() => changedGraphRoot(documentFixture(), documentFixture({}, null))).to.throw('same qualified Flow');
  });

  it('renders valid Mermaid and DOT overlays for the same node identities', (): void => {
    const result = changedGraphRoot(documentFixture(), documentFixture({ assignments: [{ name: 'Added' }] }));
    const context = { flows: [result.flow], highlights: result.highlights };
    expect(styleGraphChanges('flowchart TD\n', context, 'mermaid')).to.include('stroke:#15803d');
    expect(styleGraphChanges('digraph Flow {\n}\n', context, 'dot')).to.match(/color="#15803d".*;\n\}\n$/u);
  });
});
