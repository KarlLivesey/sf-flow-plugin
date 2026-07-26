/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { analyseFlowLintMetadata } from '../../src/utils/flow-lint-analysis.js';
import { analyseFlowMetadata } from '../../src/utils/flow-metadata-analysis.js';
import { flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definition = flowDefinition({
  id: '300000000000001',
  apiName: 'Lint_Flow',
  activeVersionId: '3010000000000001',
  latestVersionId: '3010000000000001',
});
const version = flowVersion(definition.id, 1, 'Active');

describe('analyseFlowLintMetadata structural rules', (): void => {
  it('finds unconnected elements, missing fault paths and DML inside loops', (): void => {
    const metadata = {
      start: { connector: { targetReference: 'Loop_Items' } },
      loops: [{ name: 'Loop_Items', connector: { targetReference: 'Create_Record' } }],
      recordCreates: [
        {
          name: 'Create_Record',
          connector: { targetReference: 'Loop_Items' },
          inputReference: 'recordInput',
        },
      ],
      assignments: [
        { name: 'Never_Connected', connector: { targetReference: 'Still_Unreachable' } },
        { name: 'Still_Unreachable' },
      ],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const findings = analyseFlowLintMetadata(metadata, description);
    expect(findings.map((item) => item.rule)).to.include.members([
      'unconnected-element',
      'missing-fault-path',
      'dml-inside-loop',
    ]);
    expect(findings.filter((item) => item.rule === 'unconnected-element').map((item) => item.element)).to.deep.equal([
      'Never_Connected',
      'Still_Unreachable',
    ]);
  });
});

describe('analyseFlowLintMetadata fault-path rules', (): void => {
  it('checks every supported fault-capable element collection', (): void => {
    const metadata = {
      start: { connector: { targetReference: 'Call_Action' } },
      actionCalls: [{ name: 'Call_Action', actionType: 'apex', connector: { targetReference: 'Call_Plugin' } }],
      apexPluginCalls: [{ name: 'Call_Plugin', connector: { targetReference: 'Run_Stage' } }],
      orchestratedStages: [{ name: 'Run_Stage', connector: { targetReference: 'Create_Record' } }],
      recordCreates: [{ name: 'Create_Record', connector: { targetReference: 'Delete_Record' } }],
      recordDeletes: [{ name: 'Delete_Record', connector: { targetReference: 'Find_Record' } }],
      recordLookups: [{ name: 'Find_Record', connector: { targetReference: 'Update_Record' } }],
      recordUpdates: [{ name: 'Update_Record', connector: { targetReference: 'Call_Subflow' } }],
      subflows: [{ name: 'Call_Subflow', flowName: 'Child_Flow', connector: { targetReference: 'Wait_For_Event' } }],
      waits: [{ name: 'Wait_For_Event' }],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const findings = analyseFlowLintMetadata(metadata, description);
    expect(findings.filter((item) => item.rule === 'missing-fault-path').map((item) => item.element)).to.deep.equal([
      'Call_Action',
      'Call_Plugin',
      'Run_Stage',
      'Create_Record',
      'Delete_Record',
      'Find_Record',
      'Update_Record',
      'Call_Subflow',
      'Wait_For_Event',
    ]);
  });
});

describe('analyseFlowLintMetadata value and resource rules', (): void => {
  it('finds hard-coded IDs and unused private resources', (): void => {
    const metadata = {
      start: {},
      description: 'Uses account 001000000000001AAA',
      variables: [
        {
          name: 'UnusedValue',
          dataType: 'String',
          isCollection: false,
          isInput: false,
          isOutput: false,
        },
        {
          name: 'PublicInput',
          dataType: 'String',
          isCollection: false,
          isInput: true,
          isOutput: false,
        },
      ],
      formulas: [{ name: 'UnusedFormula', dataType: 'String', expression: '"unused"' }],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const findings = analyseFlowLintMetadata(metadata, description);
    expect(findings.filter((item) => item.rule === 'hard-coded-id')).to.have.length(1);
    expect(findings.filter((item) => item.rule === 'unused-resource').map((item) => item.element)).to.deep.equal([
      'UnusedValue',
      'UnusedFormula',
    ]);
  });
});

describe('analyseFlowLintMetadata resource-reference rules', (): void => {
  it('counts references from other resource declarations without counting the resource itself', (): void => {
    const metadata = {
      start: { connector: { targetReference: 'Use_Total' } },
      assignments: [
        {
          name: 'Use_Total',
          assignmentItems: [{ value: { elementReference: 'TotalWithTax' } }],
        },
      ],
      formulas: [
        { name: 'Subtotal', dataType: 'Currency', expression: '100' },
        { name: 'TotalWithTax', dataType: 'Currency', expression: '{!Subtotal} * 1.2' },
        { name: 'UnusedFormula', dataType: 'Currency', expression: '0' },
      ],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const findings = analyseFlowLintMetadata(metadata, description);
    expect(findings.filter((item) => item.rule === 'unused-resource').map((item) => item.element)).to.deep.equal([
      'UnusedFormula',
    ]);
  });
});
