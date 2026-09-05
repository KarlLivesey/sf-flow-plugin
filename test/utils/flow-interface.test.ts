/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { compareFlowMetadata } from '../../src/utils/flow-metadata-diff.js';

describe('Flow public interface comparison', (): void => {
  const input = {
    name: 'Account',
    dataType: 'SObject',
    objectType: 'Account',
    isInput: true,
    isOutput: false,
    isCollection: false,
  };

  it('ignores implementation, descriptions and private variables', (): void => {
    const before = { variables: [input], label: 'Old' };
    const after = {
      variables: [
        { ...input, description: 'New description' },
        { name: 'Private', dataType: 'Number' },
      ],
      label: 'New',
    };
    expect(compareFlowMetadata(before, after, { interfaceOnly: true })).to.deep.equal([]);
  });

  it('detects collection, direction and type changes', (): void => {
    const changes = compareFlowMetadata(
      { variables: [input] },
      { variables: [{ ...input, isInput: false, isOutput: true, isCollection: true, objectType: 'Contact' }] },
      { interfaceOnly: true }
    );
    expect(changes.map((change) => change.path)).to.deep.equal([
      '$.variables[name="Account"].isCollection',
      '$.variables[name="Account"].isInput',
      '$.variables[name="Account"].isOutput',
      '$.variables[name="Account"].objectType',
    ]);
  });

  it('reports removal when a public variable becomes private', (): void => {
    expect(
      compareFlowMetadata(
        { variables: [input] },
        { variables: [{ ...input, isInput: false }] },
        { interfaceOnly: true }
      )[0]?.kind
    ).to.equal('removed');
  });
});
