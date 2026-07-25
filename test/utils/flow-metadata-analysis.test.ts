/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type { JsonObject } from '../../src/types/flow-analysis.js';
import { analyseFlowMetadata } from '../../src/utils/flow-metadata-analysis.js';
import { flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definition = flowDefinition({
  id: '300000000000001',
  apiName: 'Order_Processing',
  activeVersionId: '3010000000000010001',
  latestVersionId: '3010000000000010001',
});
const version = flowVersion(definition.id, 1, 'Active');
const metadata: JsonObject = {
  start: { connector: { targetReference: 'Check_Order' } },
  decisions: [
    {
      name: 'Check_Order',
      label: 'Check Order',
      rules: [{ name: 'Accepted', connector: { targetReference: 'Call_Apex' } }],
      defaultConnector: { targetReference: 'Call_Subflow' },
    },
  ],
  actionCalls: [
    {
      name: 'Call_Apex',
      label: 'Call Apex',
      actionName: 'OrderAction',
      actionType: 'apex',
      connector: { targetReference: 'Call_Subflow' },
      faultConnector: { targetReference: 'Call_Subflow' },
    },
  ],
  subflows: [{ name: 'Call_Subflow', label: 'Call Child', flowName: 'Child_Flow' }],
  variables: [
    {
      name: 'Order',
      dataType: 'SObject',
      objectType: 'Order',
      isCollection: false,
      isInput: true,
      isOutput: false,
    },
  ],
  formulas: [{ name: 'Total', dataType: 'Currency', expression: '{!Order.TotalAmount}', scale: 2 }],
  recordLookups: [{ name: 'Find_Account', label: 'Find Account', object: 'Account' }],
};

describe('analyseFlowMetadata', (): void => {
  it('summarises Flow resources and executable elements', (): void => {
    const result = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    expect(result.variables[0]).to.include({ name: 'Order', objectType: 'Order', input: true, output: false });
    expect(result.formulas[0]).to.include({ name: 'Total', expression: '{!Order.TotalAmount}' });
    expect(result.apexActions[0]).to.include({ name: 'Call_Apex', actionName: 'OrderAction' });
    expect(result.subflows[0]).to.include({ name: 'Call_Subflow', flowName: 'Child_Flow' });
    expect(result.referencedObjects).to.deep.equal(['Account', 'Order']);
    expect(result.elements.map((element) => element.name)).to.include.members([
      'start',
      'Check_Order',
      'Call_Apex',
      'Call_Subflow',
    ]);
  });

  it('extracts connector targets and decision outcome labels', (): void => {
    const result = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    expect(result.connectors).to.deep.include({
      source: 'start',
      target: 'Check_Order',
      label: null,
      kind: 'normal',
    });
    expect(result.connectors).to.deep.include({
      source: 'Check_Order',
      target: 'Call_Apex',
      label: 'Accepted',
      kind: 'outcome',
    });
    expect(result.connectors).to.deep.include({
      source: 'Call_Apex',
      target: 'Call_Subflow',
      label: null,
      kind: 'normal',
    });
    expect(result.connectors).to.deep.include({
      source: 'Check_Order',
      target: 'Call_Subflow',
      label: null,
      kind: 'default',
    });
    expect(result.connectors).to.deep.include({
      source: 'Call_Apex',
      target: 'Call_Subflow',
      label: null,
      kind: 'fault',
    });
  });
});
