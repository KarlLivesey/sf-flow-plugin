/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type { JsonObject } from '../../src/types/flow-analysis.js';
import { compareFlowMetadata } from '../../src/utils/flow-metadata-diff.js';

describe('compareFlowMetadata', (): void => {
  it('reports added, removed and changed values with stable paths', (): void => {
    const before = { label: 'Before', removed: true, nested: { count: 1 } };
    const after = { label: 'After', added: true, nested: { count: 2 } };
    expect(compareFlowMetadata(before, after)).to.deep.equal([
      { kind: 'added', path: '$.added', after: true },
      { kind: 'changed', path: '$.label', before: 'Before', after: 'After' },
      { kind: 'changed', path: '$.nested.count', before: 1, after: 2 },
      { kind: 'removed', path: '$.removed', before: true },
    ]);
  });

  it('matches named Flow elements by name instead of array position', (): void => {
    const first = {
      assignments: [
        { name: 'First', label: 'One' },
        { name: 'Second', label: 'Two' },
      ],
    };
    const reordered = { assignments: [...first.assignments].reverse() };
    expect(compareFlowMetadata(first, reordered)).to.deep.equal([]);
  });

  it('excludes top-level lifecycle status while retaining nested status fields', (): void => {
    const before: JsonObject = { status: 'Active', action: { status: 'old' } };
    const after: JsonObject = { status: 'Draft', action: { status: 'new' } };
    expect(compareFlowMetadata(before, after)).to.deep.equal([
      { kind: 'changed', path: '$.action.status', before: 'old', after: 'new' },
    ]);
  });
});

describe('compareFlowMetadata scopes and ordering', (): void => {
  it('filters changes by comparison scope', (): void => {
    const before: JsonObject = {
      label: 'Before',
      variables: [{ name: 'Input', dataType: 'String' }],
      assignments: [{ name: 'Set_Value', connector: { targetReference: 'Finish' }, label: 'Before' }],
    };
    const after: JsonObject = {
      label: 'After',
      variables: [{ name: 'Input', dataType: 'Number' }],
      assignments: [{ name: 'Set_Value', connector: { targetReference: 'Done' }, label: 'After' }],
    };
    expect(compareFlowMetadata(before, after, { scopes: ['resources', 'connectors'] })).to.deep.equal([
      {
        kind: 'changed',
        path: '$.assignments[name="Set_Value"].connector.targetReference',
        before: 'Finish',
        after: 'Done',
      },
      {
        kind: 'changed',
        path: '$.variables[name="Input"].dataType',
        before: 'String',
        after: 'Number',
      },
    ]);
  });

  it('can ignore ordering in unnamed arrays', (): void => {
    expect(compareFlowMetadata({ values: ['one', 'two'] }, { values: ['two', 'one'] })).to.have.length(2);
    expect(
      compareFlowMetadata({ values: ['one', 'two'] }, { values: ['two', 'one'] }, { ignoreOrder: true })
    ).to.deep.equal([]);
  });
});
