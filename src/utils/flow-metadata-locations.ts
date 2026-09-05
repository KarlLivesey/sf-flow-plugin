/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowMetadataLocation } from '../types/flow-document.js';

export function jsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stable, named metadata paths; element records retain their top-level owner. */
export function metadataLocations(metadata: JsonObject): FlowMetadataLocation[] {
  return Object.entries(metadata).flatMap(([key, value]) =>
    walk(value, { path: '$.' + key, element: key === 'start' ? 'start' : null, key })
  );
}

interface LocationContext {
  path: string;
  element: string | null;
  key: string;
}

function itemContext(value: JsonValue, index: number, context: LocationContext): LocationContext {
  const name = jsonObject(value) && typeof value.name === 'string' ? value.name : null;
  return {
    ...context,
    path: context.path + (name === null ? '[' + String(index) + ']' : '[name=' + JSON.stringify(name) + ']'),
    element: context.element ?? name,
  };
}

function walk(value: JsonValue, context: LocationContext): FlowMetadataLocation[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => walk(item, itemContext(item, index, context)));
  }
  if (jsonObject(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      walk(child, { ...context, key, path: context.path + '.' + key })
    );
  }
  return value === null ? [] : [{ ...context, value: String(value) }];
}
