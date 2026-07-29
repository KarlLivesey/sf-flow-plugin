/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile } from 'node:fs/promises';
import { TextDecoder } from 'node:util';

import { z } from 'zod';

import { flowInputInvalid } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';
import { parseSafeFlowJson } from './flow-number.js';

const inputObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), z.json());
const inputDocumentSchema = z.union([inputObjectSchema, z.array(inputObjectSchema).min(1)]);

export function parseInputFlags(values: ReadonlyArray<string>): JsonObject {
  const input: JsonObject = {};
  for (const value of values) {
    const separator = value.indexOf('=');
    if (separator <= 0) {
      throw flowInputInvalid(`Input "${value}" must use NAME=VALUE syntax.`);
    }
    const name = value.slice(0, separator);
    if (Object.hasOwn(input, name)) {
      throw flowInputInvalid(`Input "${name}" was specified more than once.`);
    }
    input[name] = value.slice(separator + 1);
  }
  return input;
}

export async function readFlowInputs(
  inputFile: string | undefined,
  values: ReadonlyArray<string>
): Promise<JsonObject[]> {
  if (inputFile === undefined) {
    return [parseInputFlags(values)];
  }
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(inputFile));
    const document = inputDocumentSchema.parse(parseSafeFlowJson(content));
    return Array.isArray(document) ? document : [document];
  } catch (error: unknown) {
    const detail = error instanceof RangeError ? ` ${error.message}` : '';
    throw flowInputInvalid(`Could not read valid Flow inputs from "${inputFile}".${detail}`, error);
  }
}
