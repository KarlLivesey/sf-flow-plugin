/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import { flowSourceRootFields } from './flow-source-root-schema.js';
import type { FieldSchema } from './flow-source-schema.js';

type ScalarKind = 'boolean' | 'number' | 'string';

function booleanScalar(value: string, field: string): boolean {
  if (value !== 'true' && value !== 'false') {
    throw flowSourceInvalid(`Flow source field "${field}" must contain a boolean.`);
  }
  return value === 'true';
}

function numberScalar(value: string, field: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw flowSourceInvalid(`Flow source field "${field}" must contain a decimal number.`);
  }
  return Number(value);
}

function scalar(value: unknown, kind: ScalarKind, field: string): JsonValue {
  if (typeof value === 'string') {
    return kind === 'boolean' ? booleanScalar(value, field) : kind === 'number' ? numberScalar(value, field) : value;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return value;
  }
  throw flowSourceInvalid(`Flow source contains an invalid scalar value in "${field}".`);
}

function normaliseOne(value: unknown, schema: FieldSchema | undefined, field: string): JsonValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return scalar(value, schema?.kind === 'boolean' || schema?.kind === 'number' ? schema.kind : 'string', field);
  }
  const fields = schema?.kind === 'object' ? schema.fields : undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== '$')
      .map(([name, child]) => [name, normaliseField(child, fields?.[name], `${field}.${name}`)])
  ) as JsonObject;
}

function normaliseField(value: unknown, schema: FieldSchema | undefined, field: string): JsonValue {
  const values = Array.isArray(value) ? value : [value];
  const normalised = values.map((item) => normaliseOne(item, schema, field));
  return schema?.many === true || Array.isArray(value) ? normalised : (normalised[0] as JsonValue);
}

export function normaliseFlowSourceMetadata(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== '$')
      .map(([name, child]) => [name, normaliseField(child, flowSourceRootFields[name], `Flow.${name}`)])
  ) as JsonObject;
}
