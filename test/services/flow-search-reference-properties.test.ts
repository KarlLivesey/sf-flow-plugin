/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { loadFlowSource } from '../../src/services/flow-source-service.js';
import { searchFlowDocuments } from '../../src/services/flow-search-service.js';
import { inspectFlowResources } from '../../src/services/flow-resources-service.js';
import type { FlowDocument } from '../../src/types/flow-document.js';
import { renderFlowMetadataXmlForComparison } from '../../src/utils/flow-metadata-xml.js';
import { documentFixture } from '../helpers/flow-document-fixtures.js';

function referenceDocument(): FlowDocument {
  return documentFixture({
    variables: [{ name: 'Name', dataType: 'String', isInput: false, isOutput: false, isCollection: false }],
    transforms: [
      {
        name: 'Map',
        transformValues: [
          { transformValueActions: [{ outputFieldApiName: 'Name' }, { outputFieldApiName: 'Name' }] },
          { transformValueActions: [{ outputFieldApiName: 'Other' }] },
        ],
      },
    ],
    dynamicChoiceSets: [{ name: 'Options', picklistObject: 'Account' }],
    description: 'An Account.Name field description',
    fieldConfiguration: 'Name',
    objectConfiguration: 'Account',
  });
}

function verifyReferences(document: FlowDocument): void {
  const before = JSON.stringify(document);
  const fields = searchFlowDocuments([document], 'name', { kind: 'field', caseSensitive: false });
  expect(fields.matches.map(({ key, value, path }) => ({ key, value, path }))).to.deep.equal([
    {
      key: 'outputFieldApiName',
      value: 'Name',
      path: '$.transforms[name="Map"].transformValues[0].transformValueActions[0].outputFieldApiName',
    },
    {
      key: 'outputFieldApiName',
      value: 'Name',
      path: '$.transforms[name="Map"].transformValues[0].transformValueActions[1].outputFieldApiName',
    },
  ]);
  expect(
    searchFlowDocuments([document], 'Account', { kind: 'object', caseSensitive: true }).matches.map(
      ({ key, value }) => ({ key, value })
    )
  ).to.deep.equal([{ key: 'picklistObject', value: 'Account' }]);
  expect(inspectFlowResources(document).resources.find((resource) => resource.name === 'Name')?.usedBy).to.deep.equal(
    []
  );
  expect(searchFlowDocuments([document], 'Name', { kind: 'subflow', caseSensitive: false }).matches).to.deep.equal([]);
  expect(
    searchFlowDocuments([document], 'Account.Name', { kind: 'field', caseSensitive: false }).matches
  ).to.deep.equal([]);
  expect(JSON.stringify(document)).to.equal(before);
}

describe('Explicit transform and picklist search properties', (): void => {
  it('classifies org metadata without inferring resource usage or field ownership', (): void => {
    verifyReferences(referenceDocument());
  });

  it('preserves repeated nested locations in local XML too', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow search references '));
    const file = join(directory, 'managed__Root_Flow.flow-meta.xml');
    try {
      await writeFile(file, renderFlowMetadataXmlForComparison(referenceDocument().metadata));
      const source = await loadFlowSource(file);
      verifyReferences({
        metadata: source.metadata,
        description: source.description,
        sourceFile: file,
        targetOrg: null,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains literal whitespace and case-sensitive matching', (): void => {
    const document = referenceDocument();
    expect(searchFlowDocuments([document], ' Name ', { kind: 'field', caseSensitive: false }).matches).to.deep.equal(
      []
    );
    expect(searchFlowDocuments([document], 'name', { kind: 'field', caseSensitive: true }).matches).to.deep.equal([]);
    expect(searchFlowDocuments([document], 'Name', { kind: 'field', caseSensitive: true }).matches).to.have.length(2);
  });
});
