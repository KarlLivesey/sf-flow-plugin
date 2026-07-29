/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type { JsonObject } from '../../src/types/flow-analysis.js';
import { canonicalFlowComparisonMetadata } from '../../src/utils/flow-comparison-canonical.js';

const toolingMetadata: JsonObject = {
  actionCalls: [
    {
      actionName: 'ExampleAction',
      actionType: 'apex',
      inputParameters: [{ name: 'input', value: { stringValue: 'value' } }],
      isWaitUntilCompleted: true,
      label: 'Call action',
      locationX: 300,
      locationY: 400,
      name: 'Call_Action',
    },
  ],
  apiVersion: 65,
  label: 'Canonical Flow',
  processType: 'AutoLaunchedFlow',
  recordCreates: [
    {
      doesUpsert: true,
      filters: [{ field: 'Name', operator: 'EqualTo', value: { stringValue: 'Example' } }],
      label: 'Create record',
      locationX: 100,
      locationY: 200,
      name: 'Create_Record',
    },
  ],
  screens: [
    {
      fields: [{ dataType: 'String', fieldType: 'InputField', name: 'Input_Field' }],
      label: 'Input screen',
      locationX: 500,
      locationY: 600,
      name: 'Input_Screen',
    },
  ],
  start: {
    inputs: [{ name: 'StartValue', value: { stringValue: 'Example' } }],
    locationX: 0,
    locationY: 0,
  },
  status: 'Draft',
};

const sourceMetadata: JsonObject = {
  actionCalls: [
    {
      actionName: 'ExampleAction',
      actionType: 'apex',
      inputParameters: { name: 'input', value: { stringValue: 'value' } },
      isWaitUntilCompleted: true,
      label: 'Call action',
      locationX: 300,
      locationY: 400,
      name: 'Call_Action',
    },
  ],
  apiVersion: 65,
  label: 'Canonical Flow',
  processType: 'AutoLaunchedFlow',
  recordCreates: [
    {
      doesUpsert: true,
      filters: { field: 'Name', operator: 'EqualTo', value: { stringValue: 'Example' } },
      label: 'Create record',
      locationX: 100,
      locationY: 200,
      name: 'Create_Record',
    },
  ],
  screens: [
    {
      fields: { dataType: 'String', fieldType: 'InputField', name: 'Input_Field' },
      label: 'Input screen',
      locationX: 500,
      locationY: 600,
      name: 'Input_Screen',
    },
  ],
  start: {
    inputs: { name: 'StartValue', value: { stringValue: 'Example' } },
    locationX: 0,
    locationY: 0,
  },
  status: 'Draft',
};

describe('canonicalFlowComparisonMetadata', (): void => {
  it('normalises Tooling metadata and source XML cardinality through one generic XML representation', async (): Promise<void> => {
    expect(await canonicalFlowComparisonMetadata(sourceMetadata)).to.deep.equal(
      await canonicalFlowComparisonMetadata(toolingMetadata)
    );
  });
});
