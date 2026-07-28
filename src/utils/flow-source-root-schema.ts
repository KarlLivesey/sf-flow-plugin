/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  baseFields,
  boolean,
  conditions,
  connector,
  elementFields,
  type FieldSchema,
  filterFields,
  inputFieldFields,
  inputParameterFields,
  metadataValueFields,
  node,
  nodeFields,
  number,
  object,
  outputFieldFields,
  outputParameterFields,
  ruleFields,
  screenFieldFields,
  screenRuleFields,
  string,
  validationRule,
  value,
  waitEventFields,
} from './flow-source-schema.js';

export const flowSourceRootFields: Readonly<Record<string, FieldSchema>> = {
  apiVersion: number(),
  actionCalls: node({
    actionName: string(),
    actionType: string(),
    connector,
    faultConnector: connector,
    inputParameters: object(inputParameterFields, true),
    outputParameters: object(outputParameterFields, true),
    storeOutputAutomatically: boolean(),
  }),
  apexPluginCalls: node({
    apexClass: string(),
    connector,
    faultConnector: connector,
    inputParameters: object(inputParameterFields, true),
    outputParameters: object(outputParameterFields, true),
  }),
  assignments: node({
    assignmentItems: object(
      {
        ...baseFields,
        assignToReference: string(),
        operator: string(),
        value,
      },
      true
    ),
    connector,
  }),
  choices: object(
    {
      ...elementFields,
      choiceText: string(),
      dataType: string(),
      userInput: object({
        ...baseFields,
        isRequired: boolean(),
        promptText: string(),
        validationRule,
      }),
      value,
    },
    true
  ),
  collectionProcessors: node({
    conditions,
    connector,
    limit: number(),
    outputAssignments: object(outputFieldFields, true),
    sortOptions: object({ sortField: string(), sortOrder: string() }, true),
  }),
  constants: object({ ...elementFields, dataType: string(), value }, true),
  customErrors: node({
    customErrorMessages: object(
      {
        errorMessage: string(),
        isFieldError: boolean(),
      },
      true
    ),
  }),
  decisions: node({
    defaultConnector: connector,
    rules: object(ruleFields, true),
  }),
  dynamicChoiceSets: object(
    {
      ...elementFields,
      dataType: string(),
      filters: object(filterFields, true),
      limit: number(),
      outputAssignments: object(outputFieldFields, true),
    },
    true
  ),
  formulas: object({ ...elementFields, dataType: string(), expression: string(), scale: number() }, true),
  isAdditionalPermissionRequiredToRun: boolean(),
  isTemplate: boolean(),
  loops: node({
    nextValueConnector: connector,
    noMoreValuesConnector: connector,
  }),
  orchestratedStages: node({
    exitActionInputParameters: object(inputParameterFields, true),
    stageSteps: object({ ...elementFields }, true),
  }),
  processMetadataValues: object(metadataValueFields, true),
  recordCreates: node({
    connector,
    faultConnector: connector,
    inputAssignments: object(inputFieldFields, true),
    storeOutputAutomatically: boolean(),
  }),
  recordDeletes: node({
    connector,
    faultConnector: connector,
    filters: object(filterFields, true),
  }),
  recordLookups: node({
    assignNullValuesIfNoRecordsFound: boolean(),
    connector,
    faultConnector: connector,
    filters: object(filterFields, true),
    getFirstRecordOnly: boolean(),
    outputAssignments: object(outputFieldFields, true),
    queriedFields: string(true),
    storeOutputAutomatically: boolean(),
  }),
  recordRollbacks: node({ connector, faultConnector: connector }),
  recordUpdates: node({
    connector,
    faultConnector: connector,
    filters: object(filterFields, true),
    inputAssignments: object(inputFieldFields, true),
  }),
  screens: node({
    allowBack: boolean(),
    allowFinish: boolean(),
    allowPause: boolean(),
    connector,
    fields: object(screenFieldFields, true),
    rules: object(screenRuleFields, true),
    showFooter: boolean(),
    showHeader: boolean(),
  }),
  stages: object({ ...elementFields, isActive: boolean(), label: string(), stageOrder: number() }, true),
  start: object({
    ...nodeFields,
    connector,
    filters: object(filterFields, true),
    scheduledPaths: object(
      {
        connector,
        offsetNumber: number(),
        offsetUnit: string(),
        pathType: string(),
        recordField: string(),
      },
      true
    ),
  }),
  steps: node({ connectors: object({ ...baseFields, targetReference: string() }, true) }),
  subflows: node({
    connector,
    faultConnector: connector,
    inputAssignments: object(inputParameterFields, true),
    outputAssignments: object(outputParameterFields, true),
    storeOutputAutomatically: boolean(),
  }),
  textTemplates: object({ ...elementFields, text: string() }, true),
  transforms: node({
    dataTypeMappings: object({ sourceDataType: string(), targetDataType: string() }, true),
    transformValues: object(
      {
        ...baseFields,
        outputFieldApiName: string(),
        value,
      },
      true
    ),
  }),
  variables: object(
    {
      ...elementFields,
      dataType: string(),
      isCollection: boolean(),
      isInput: boolean(),
      isOutput: boolean(),
      scale: number(),
      value,
    },
    true
  ),
  waits: node({
    defaultConnector: connector,
    faultConnector: connector,
    waitEvents: object(waitEventFields, true),
  }),
};
