/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect } from 'chai';

import { loadFlowSource } from '../../src/services/flow-source-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

const fixture = resolve('test/nuts/fixtures/project/v3/main/default/flows/Plugin_Test_Flow.flow-meta.xml');

function flowXml(rootAttributes = 'xmlns="http://soap.sforce.com/2006/04/metadata"'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow ${rootAttributes}>
  <label>Local Flow</label>
  <processType>AutoLaunchedFlow</processType>
  <start><connector><targetReference>Set_Output</targetReference></connector></start>
  <status>Draft</status>
  <assignments><name>Set_Output</name><label>Set Output</label></assignments>
  <variables>
    <name>Result</name>
    <dataType>String</dataType>
    <isCollection>false</isCollection>
    <isInput>false</isInput>
    <isOutput>true</isOutput>
  </variables>
</Flow>`;
}

describe('loadFlowSource', (): void => {
  it('loads and normalises deployable Flow metadata without an org', async (): Promise<void> => {
    const source = await loadFlowSource(fixture);
    expect(source.apiName).to.equal('Plugin_Test_Flow');
    expect(source.namespace).to.equal(null);
    expect(source.sourceFile).to.equal(fixture);
    expect(source.description).to.include({
      qualifiedName: 'Plugin_Test_Flow',
      definitionId: null,
      versionId: null,
      versionNumber: null,
      status: 'Draft',
      processType: 'AutoLaunchedFlow',
    });
    expect(source.description.variables).to.deep.include({
      name: 'Result',
      dataType: 'String',
      objectType: null,
      apexClass: null,
      collection: false,
      input: false,
      output: true,
      description: null,
    });
    expect(source.description.connectors).to.deep.include({
      source: 'start',
      target: 'Set_Output',
      label: null,
      kind: 'normal',
    });
  });

  it('derives a managed namespace from the source filename', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-managed-'));
    const file = join(directory, 'managed__Local_Flow.flow-meta.xml');
    try {
      await writeFile(file, flowXml(), 'utf8');
      const source = await loadFlowSource(file);
      expect(source.apiName).to.equal('Local_Flow');
      expect(source.namespace).to.equal('managed');
      expect(source.description.qualifiedName).to.equal('managed__Local_Flow');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('loadFlowSource validation', (): void => {
  it('rejects malformed XML, the wrong namespace and entity declarations', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-invalid-'));
    try {
      const malformed = join(directory, 'Malformed.flow-meta.xml');
      const wrongNamespace = join(directory, 'Wrong_Namespace.flow-meta.xml');
      const entity = join(directory, 'Entity.flow-meta.xml');
      await Promise.all([
        writeFile(malformed, '<Flow>', 'utf8'),
        writeFile(wrongNamespace, flowXml('xmlns="https://example.com/not-salesforce"'), 'utf8'),
        writeFile(entity, `<!DOCTYPE Flow [<!ENTITY external SYSTEM "file:///etc/passwd">]>${flowXml()}`, 'utf8'),
      ]);
      await expectErrorName(loadFlowSource(malformed), 'FlowSourceInvalid');
      await expectErrorName(loadFlowSource(wrongNamespace), 'FlowSourceInvalid');
      await expectErrorName(loadFlowSource(entity), 'FlowSourceInvalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
