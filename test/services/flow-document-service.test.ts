/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { loadOrgDocuments, selectDocuments } from '../../src/services/flow-document-service.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

describe('Flow document selection', (): void => {
  const definitions = [
    { apiName: 'Root', namespace: null },
    { apiName: 'Root', namespace: 'managed' },
  ];

  it('rejects an ambiguous bare name and honours qualified names', (): void => {
    expect(() => selectDocuments(definitions, { apiNames: ['Root'] })).to.throw('ambiguous');
    expect(selectDocuments(definitions, { apiNames: ['managed__Root'] })).to.deep.equal([definitions[1]]);
  });

  it('does not silently ignore missing selected names except when checking drift', (): void => {
    expect(() => selectDocuments(definitions, { apiNames: ['Missing'] })).to.throw('missing');
    expect(selectDocuments(definitions, { apiNames: ['Missing'], allowMissing: true })).to.deep.equal([]);
  });

  it('loads versions in bulk and never mutates', async (): Promise<void> => {
    const gateway = nestedFlowGateway();
    const documents = await loadOrgDocuments(gateway, { apiNames: [], version: 'latest', targetOrg: 'org' });
    expect(documents).to.have.length(2);
    expect(gateway.allVersionQueries).to.equal(1);
    expect(gateway.versionQueries).to.deep.equal([]);
    expect(gateway.updates).to.deep.equal([]);
  });

  it('fails when a selected version is unavailable', async (): Promise<void> => {
    await expectErrorName(
      loadOrgDocuments(nestedFlowGateway(), { apiNames: ['Flow_A'], version: 99, targetOrg: 'org' }),
      'FlowInspectionFailed'
    );
  });
});
