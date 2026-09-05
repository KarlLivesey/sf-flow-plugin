/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export interface FieldSchema {
  kind: 'boolean' | 'integer' | 'number' | 'object' | 'string';
  many?: boolean;
  fields?: Readonly<Record<string, FieldSchema>>;
}

export const string = (many = false): FieldSchema => ({ kind: 'string', many });
export const number = (many = false): FieldSchema => ({ kind: 'number', many });
export const integer = (many = false): FieldSchema => ({ kind: 'integer', many });
export const boolean = (many = false): FieldSchema => ({ kind: 'boolean', many });
export const object = (fields: Readonly<Record<string, FieldSchema>>, many = false): FieldSchema => ({
  kind: 'object',
  fields,
  many,
});

export const valueFields: Readonly<Record<string, FieldSchema>> = {
  booleanValue: boolean(),
  dateTimeValue: string(),
  dateValue: string(),
  elementReference: string(),
  numberValue: number(),
  stringValue: string(),
};
export const value = object(valueFields);
export const metadataValueFields: Readonly<Record<string, FieldSchema>> = {
  name: string(),
  value,
};
export const baseFields: Readonly<Record<string, FieldSchema>> = {
  processMetadataValues: object(metadataValueFields, true),
};
export const elementFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  description: string(),
  name: string(),
};
export const nodeFields: Readonly<Record<string, FieldSchema>> = {
  ...elementFields,
  label: string(),
  locationX: integer(),
  locationY: integer(),
};
export const connector = object({ ...baseFields, targetReference: string() });
export const conditionFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  leftValueReference: string(),
  operator: string(),
  rightValue: value,
};
export const conditions = object(conditionFields, true);
export const inputParameterFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  name: string(),
  value,
};
export const outputParameterFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  assignToReference: string(),
  name: string(),
};
export const inputFieldFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  field: string(),
  value,
};
export const outputFieldFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  assignToReference: string(),
  field: string(),
};
export const filterFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  field: string(),
  operator: string(),
  value,
};
export const validationRule = object({
  errorMessage: string(),
  formulaExpression: string(),
});

export function node(extra: Readonly<Record<string, FieldSchema>> = {}): FieldSchema {
  return object({ ...nodeFields, ...extra }, true);
}

export const ruleFields: Readonly<Record<string, FieldSchema>> = {
  ...elementFields,
  conditionLogic: string(),
  conditions,
  connector,
  label: string(),
};
export const visibilityRule = object({
  ...baseFields,
  conditionLogic: string(),
  conditions,
});
export const screenFieldFields: Readonly<Record<string, FieldSchema>> = {
  ...elementFields,
  choiceReferences: string(true),
  dataType: string(),
  defaultSelectedChoiceReference: string(),
  defaultValue: value,
  extensionName: string(),
  fieldText: string(),
  fieldType: string(),
  helpText: string(),
  inputParameters: object(inputParameterFields, true),
  isRequired: boolean(),
  isVisible: boolean(),
  outputParameters: object(outputParameterFields, true),
  scale: integer(),
  storeOutputAutomatically: boolean(),
  validationRule,
  visibilityRule,
};
export const screenRuleFields: Readonly<Record<string, FieldSchema>> = {
  ...baseFields,
  conditionLogic: string(),
  conditions,
  label: string(),
  ruleActions: object(
    {
      ...baseFields,
      attribute: string(),
      fieldReference: string(),
      value,
    },
    true
  ),
};
export const waitEventFields: Readonly<Record<string, FieldSchema>> = {
  ...elementFields,
  conditionLogic: string(),
  conditions,
  connector,
  eventType: string(),
  inputParameters: object(inputParameterFields, true),
  label: string(),
  outputParameters: object(outputParameterFields, true),
};
