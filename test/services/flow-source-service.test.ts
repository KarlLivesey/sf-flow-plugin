/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect } from 'chai';

import { loadFlowSource, verifyFlowSourceSnapshot } from '../../src/services/flow-source-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

const fixture = resolve('test/nuts/fixtures/project/v3/main/default/flows/Plugin_Test_Flow.flow-meta.xml');
const equivalentMetadataXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>65.0</apiVersion>
  <assignments>
    <name>Assign_Total</name><label>Assign Total</label><locationX>10</locationX><locationY>20</locationY>
    <assignmentItems>
      <assignToReference>Total</assignToReference><operator>Assign</operator>
      <value><numberValue>1.5</numberValue></value>
    </assignmentItems>
  </assignments>
  <decisions>
    <name>Check_Total</name><label>Check Total</label><locationX>30</locationX><locationY>40</locationY>
    <rules>
      <name>Positive</name><conditionLogic>and</conditionLogic><label>Positive</label>
      <conditions>
        <leftValueReference>Total</leftValueReference><operator>GreaterThan</operator>
        <rightValue><numberValue>0</numberValue></rightValue>
      </conditions>
    </rules>
  </decisions>
  <recordLookups>
    <name>Find_Record</name><label>Find Record</label><locationX>50</locationX><locationY>60</locationY>
    <filters>
      <field>Active__c</field><operator>EqualTo</operator><value><booleanValue>true</booleanValue></value>
    </filters>
    <getFirstRecordOnly>true</getFirstRecordOnly><object>Account</object><queriedFields>Name</queriedFields>
  </recordLookups>
  <screens>
    <name>Details</name><label>Details</label><locationX>70</locationX><locationY>80</locationY>
    <allowBack>false</allowBack><showFooter>true</showFooter>
    <fields>
      <name>Amount</name><dataType>Number</dataType><fieldType>InputField</fieldType><isRequired>true</isRequired>
      <inputParameters><name>minimum</name><value><numberValue>0</numberValue></value></inputParameters>
      <outputParameters><assignToReference>Total</assignToReference><name>value</name></outputParameters>
    </fields>
  </screens>
  <subflows>
    <name>Child</name><label>Child</label><locationX>90</locationX><locationY>100</locationY>
    <flowName>Child_Flow</flowName>
    <inputAssignments><name>Input</name><value><elementReference>Total</elementReference></value></inputAssignments>
    <outputAssignments><assignToReference>Total</assignToReference><name>Output</name></outputAssignments>
  </subflows>
  <label>Equivalent Flow</label><processType>AutoLaunchedFlow</processType><status>Draft</status>
  <variables>
    <name>Total</name><dataType>Number</dataType><isCollection>false</isCollection>
    <isInput>true</isInput><isOutput>true</isOutput><scale>2</scale>
  </variables>
</Flow>`;

const equivalentToolingMetadata = {
  apiVersion: 65,
  assignments: [
    {
      name: 'Assign_Total',
      label: 'Assign Total',
      locationX: 10,
      locationY: 20,
      assignmentItems: [{ assignToReference: 'Total', operator: 'Assign', value: { numberValue: 1.5 } }],
    },
  ],
  decisions: [
    {
      name: 'Check_Total',
      label: 'Check Total',
      locationX: 30,
      locationY: 40,
      rules: [
        {
          name: 'Positive',
          conditionLogic: 'and',
          label: 'Positive',
          conditions: [
            {
              leftValueReference: 'Total',
              operator: 'GreaterThan',
              rightValue: { numberValue: 0 },
            },
          ],
        },
      ],
    },
  ],
  recordLookups: [
    {
      name: 'Find_Record',
      label: 'Find Record',
      locationX: 50,
      locationY: 60,
      filters: [{ field: 'Active__c', operator: 'EqualTo', value: { booleanValue: true } }],
      getFirstRecordOnly: true,
      object: 'Account',
      queriedFields: ['Name'],
    },
  ],
  screens: [
    {
      name: 'Details',
      label: 'Details',
      locationX: 70,
      locationY: 80,
      allowBack: false,
      showFooter: true,
      fields: [
        {
          name: 'Amount',
          dataType: 'Number',
          fieldType: 'InputField',
          isRequired: true,
          inputParameters: [{ name: 'minimum', value: { numberValue: 0 } }],
          outputParameters: [{ assignToReference: 'Total', name: 'value' }],
        },
      ],
    },
  ],
  subflows: [
    {
      name: 'Child',
      label: 'Child',
      locationX: 90,
      locationY: 100,
      flowName: 'Child_Flow',
      inputAssignments: [{ name: 'Input', value: { elementReference: 'Total' } }],
      outputAssignments: [{ assignToReference: 'Total', name: 'Output' }],
    },
  ],
  label: 'Equivalent Flow',
  processType: 'AutoLaunchedFlow',
  status: 'Draft',
  variables: [
    {
      name: 'Total',
      dataType: 'Number',
      isCollection: false,
      isInput: true,
      isOutput: true,
      scale: 2,
    },
  ],
};

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

describe('loadFlowSource Tooling metadata compatibility', (): void => {
  it('matches the typed collection shape returned by Tooling Flow.Metadata', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-equivalent-'));
    const file = join(directory, 'Equivalent_Flow.flow-meta.xml');
    try {
      await writeFile(file, equivalentMetadataXml, 'utf8');
      expect((await loadFlowSource(file)).metadata).to.deep.equal(equivalentToolingMetadata);
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

describe('loadFlowSource stable numeric and file identity validation', (): void => {
  it('rejects non-finite decimal metadata and unsafe integer metadata', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-number-'));
    const nonFinite = join(directory, 'Non_Finite.flow-meta.xml');
    const unsafeInteger = join(directory, 'Unsafe_Integer.flow-meta.xml');
    try {
      await Promise.all([
        writeFile(
          nonFinite,
          flowXml().replace('<status>', `<apiVersion>${'9'.repeat(400)}</apiVersion><status>`),
          'utf8'
        ),
        writeFile(
          unsafeInteger,
          flowXml().replace(
            '<label>Set Output</label>',
            '<label>Set Output</label><locationX>9007199254740992</locationX>'
          ),
          'utf8'
        ),
      ]);
      await expectErrorName(loadFlowSource(nonFinite), 'FlowSourceInvalid');
      await expectErrorName(loadFlowSource(unsafeInteger), 'FlowSourceInvalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects an atomic replacement after loading the source snapshot', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-replaced-'));
    const file = join(directory, 'Replaced.flow-meta.xml');
    const replacement = join(directory, 'Replacement.flow-meta.xml');
    try {
      await writeFile(file, flowXml(), 'utf8');
      const source = await loadFlowSource(file);
      await writeFile(replacement, flowXml().replace('Local Flow', 'Replacement Flow'), 'utf8');
      await rename(replacement, file);
      await expectErrorName(verifyFlowSourceSnapshot(source.snapshot), 'FlowSourceInvalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
