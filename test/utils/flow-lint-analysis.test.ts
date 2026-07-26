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
      assignments: [{ name: 'Never_Connected' }],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const findings = analyseFlowLintMetadata(metadata, description);
    expect(findings.map((item) => item.rule)).to.include.members([
      'unconnected-element',
      'missing-fault-path',
      'dml-inside-loop',
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
