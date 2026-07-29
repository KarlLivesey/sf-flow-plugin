/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { parseStringPromise } from 'xml2js';
import { z } from 'zod';

import { flowComparisonFailed } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import { renderFlowMetadataXml } from './flow-metadata-xml.js';

const parsedFlowSchema = z.object({
  Flow: z.record(z.string(), z.unknown()),
});

function canonicalValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([name]) => name !== '$')
        .map(([name, child]) => [name, canonicalValue(child)])
    );
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  throw flowComparisonFailed('Flow metadata could not be converted to a canonical comparison form.');
}

export async function canonicalFlowComparisonMetadata(metadata: JsonObject): Promise<JsonObject> {
  try {
    const status = metadata.status === 'Active' ? 'active' : 'draft';
    const parsed: unknown = await parseStringPromise(renderFlowMetadataXml(metadata, status), {
      explicitArray: true,
      explicitRoot: true,
      strict: true,
      trim: false,
    });
    const root = parsedFlowSchema.parse(parsed).Flow;
    return canonicalValue(root) as JsonObject;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowComparisonFailed') {
      throw error;
    }
    throw flowComparisonFailed('Flow metadata could not be converted to a canonical comparison form.', error);
  }
}
