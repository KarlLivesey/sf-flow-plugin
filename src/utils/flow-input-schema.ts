/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import { flowInputInvalid } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowVariableSummary } from '../types/flow-inspection.js';
import { parseSafeFlowJson, preprocessFlowNumber } from './flow-number.js';

const NUMBER_POLICY_MESSAGE =
  'Use decimal notation, a safe whole number, or a fractional value with at most 15 significant digits.';

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return parseSafeFlowJson(value);
  } catch {
    return value;
  }
}

function booleanSchema(): z.ZodType<JsonValue> {
  return z.preprocess((value) => {
    if (value === 'true' || value === '1') {
      return true;
    }
    if (value === 'false' || value === '0') {
      return false;
    }
    return value;
  }, z.boolean());
}

function numberSchema(integer: boolean): z.ZodType<JsonValue> {
  return z.unknown().transform((value, context) => {
    const parsed = preprocessFlowNumber(value, integer);
    const valid =
      typeof parsed === 'number' &&
      Number.isFinite(parsed) &&
      Math.abs(parsed) <= Number.MAX_SAFE_INTEGER &&
      !Object.is(parsed, -0) &&
      (!integer || Number.isSafeInteger(parsed));
    if (!valid) {
      context.addIssue({ code: 'custom', message: NUMBER_POLICY_MESSAGE });
      return z.NEVER;
    }
    return parsed;
  });
}

const TEXT_SCHEMA: z.ZodType<JsonValue> = z.string();
const SCALAR_SCHEMAS: Readonly<Record<string, z.ZodType<JsonValue>>> = {
  boolean: booleanSchema(),
  currency: numberSchema(false),
  date: z.string().date(),
  datetime: z.string().datetime({ offset: true }),
  decimal: numberSchema(false),
  double: numberSchema(false),
  integer: numberSchema(true),
  long: numberSchema(true),
  number: numberSchema(false),
  percent: numberSchema(false),
};

function scalarSchema(variable: FlowVariableSummary): z.ZodType<JsonValue> {
  const dataType = variable.dataType.toLowerCase();
  const known = SCALAR_SCHEMAS[dataType];
  if (known !== undefined) {
    return known;
  }
  if (['apex', 'sobject'].includes(dataType) || variable.objectType !== null || variable.apexClass !== null) {
    return z.preprocess(parseJsonString, z.record(z.string(), z.json()));
  }
  return TEXT_SCHEMA;
}

function variableSchema(variable: FlowVariableSummary): z.ZodType<JsonValue> {
  const scalar = scalarSchema(variable);
  return variable.collection ? z.preprocess(parseJsonString, z.array(scalar)) : scalar;
}

function validationMessage(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || 'input'}: ${issue.message}`).join('; ');
}

export function validateFlowInputs(
  inputs: ReadonlyArray<JsonObject>,
  variables: ReadonlyArray<FlowVariableSummary>
): JsonObject[] {
  const inputVariables = variables.filter((variable) => variable.input);
  const shape = Object.fromEntries(inputVariables.map((variable) => [variable.name, variableSchema(variable)]));
  const schema = z.object(shape).partial().strict();
  return inputs.map((input, index) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw flowInputInvalid(`Invocation ${index + 1} has invalid inputs: ${validationMessage(parsed.error)}`);
    }
    const validated: JsonObject = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        validated[key] = value;
      }
    }
    return validated;
  });
}
