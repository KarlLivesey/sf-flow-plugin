/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';

const SENSITIVE_KEY = /(?:authorization|credential|password|secret|session|token)/i;

export function redactFlowValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(redactFlowValue);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactFlowValue(child)])
  );
}

export function redactFlowObject(value: JsonObject): JsonObject {
  return redactFlowValue(value) as JsonObject;
}
