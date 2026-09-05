/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';

const CONTRACT_FIELDS = ['name', 'dataType', 'objectType', 'apexClass', 'isCollection', 'isInput', 'isOutput'];

/** Project only public input/output contracts; ignore internal resources and presentation metadata. */
export function flowInterface(metadata: JsonObject): JsonObject {
  const variables = Array.isArray(metadata.variables) ? metadata.variables : [];
  return { variables: variables.filter(publicVariable).map(contract) };
}

function publicVariable(value: JsonValue): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value.isInput === true || value.isOutput === true)
  );
}

function contract(variable: JsonObject): JsonObject {
  return Object.fromEntries(
    CONTRACT_FIELDS.map((key) => [key, variable[key] ?? (key.startsWith('is') ? false : null)])
  );
}
