/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { inspectFlowResources } from '../../src/services/flow-resources-service.js';
import { searchFlowDocuments } from '../../src/services/flow-search-service.js';
import { explainFlowElement } from '../../src/services/flow-explain-service.js';
import { documentFixture } from '../helpers/flow-document-fixtures.js';

describe('Flow resource references', (): void => {
  it('counts references from other resources but not self declarations or quoted formula text', (): void => {
    const document = documentFixture({
      formulas: [
        { name: 'Subtotal', dataType: 'Number', expression: '1' },
        { name: 'Total', dataType: 'Number', expression: 'Subtotal * 1.2' },
        { name: 'Text', dataType: 'String', expression: '"Subtotal"' },
      ],
      textTemplates: [{ name: 'Display', text: 'Total: {!Total}' }],
    });
    const resources = inspectFlowResources(document).resources;
    expect(resources.find((resource) => resource.name === 'Subtotal')?.usedBy.map((use) => use.element)).to.deep.equal([
      'Total',
    ]);
    expect(resources.find((resource) => resource.name === 'Total')?.usedBy.map((use) => use.element)).to.deep.equal([
      'Display',
    ]);
  });

  it('does not match resource-name prefixes', (): void => {
    const document = documentFixture({
      constants: [{ name: 'Value', dataType: 'String' }],
      assignments: [{ name: 'Set', assignmentItems: [{ assignToReference: 'ValueOther' }] }],
    });
    expect(inspectFlowResources(document).resources[0]?.usedBy).to.deep.equal([]);
  });
});

describe('Flow metadata search and explanation', (): void => {
  it('finds object references with stable qualified identities and paths', (): void => {
    const result = searchFlowDocuments(
      [documentFixture({ recordLookups: [{ name: 'Find', object: 'Account' }] })],
      'account',
      { kind: 'object', caseSensitive: false }
    );
    expect(result.matches).to.have.length(1);
    expect(result.matches[0]).to.include({
      flow: 'managed__Root_Flow',
      element: 'Find',
      path: '$.recordLookups[name="Find"].object',
    });
  });

  it('treats special characters literally and honours case', (): void => {
    const document = documentFixture({ description: 'A.*B' });
    expect(searchFlowDocuments([document], '.*', { kind: 'text', caseSensitive: true }).matches).to.have.length(1);
    expect(searchFlowDocuments([document], 'a.*b', { kind: 'text', caseSensitive: true }).matches).to.have.length(0);
  });
});

describe('Flow element explanations', (): void => {
  it('explains conditions, assignments and outgoing paths without execution', (): void => {
    const result = explainFlowElement(
      documentFixture({
        decisions: [
          {
            name: 'Check',
            label: 'Check amount',
            rules: [
              {
                name: 'Yes',
                conditions: [
                  { leftValueReference: 'Amount', operator: 'GreaterThan', rightValue: { numberValue: 10 } },
                ],
                connector: { targetReference: 'Save' },
              },
            ],
          },
        ],
        recordCreates: [{ name: 'Save', object: 'Account' }],
      }),
      'Check'
    );
    expect(result.flow).to.equal('managed__Root_Flow');
    expect(result.details.some((detail) => detail.key === 'operator' && detail.value === 'GreaterThan')).to.equal(true);
    expect(result.outgoing[0]).to.include({ target: 'Save', kind: 'outcome' });
  });

  it('rejects an unknown element', (): void => {
    expect(() => explainFlowElement(documentFixture(), 'Missing')).to.throw('was not found');
  });
});
