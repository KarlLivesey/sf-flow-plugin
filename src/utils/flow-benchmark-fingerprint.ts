/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { createHash } from 'node:crypto';

import type { JsonObject, JsonValue } from '../types/flow-analysis.js';

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key] ?? null)])
    );
  }
  return value;
}

/** Record input equivalence without writing raw Flow inputs into benchmark reports. */
export function fingerprintBenchmarkInputs(inputs: JsonObject[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(inputs)))
    .digest('hex');
}
