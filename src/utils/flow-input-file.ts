/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { open, readFile } from 'node:fs/promises';

import { z } from 'zod';

import { flowInputInvalid } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';
import { parseSafeFlowJson } from './flow-number.js';

const inputObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), z.json());
const inputDocumentSchema = z.union([inputObjectSchema, z.array(inputObjectSchema).min(1)]);

export interface FlowInputFileLimits {
  maxBytes?: number;
  maxObjects?: number;
}

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

function parseInputDocument(content: string, limits: FlowInputFileLimits): JsonObject[] {
  const document = inputDocumentSchema.parse(parseSafeFlowJson(content));
  const inputs = Array.isArray(document) ? document : [document];
  if (limits.maxObjects !== undefined && inputs.length > limits.maxObjects) {
    throw new RangeError(`The input file exceeds the plugin safety limit of ${limits.maxObjects} input objects.`);
  }
  return inputs;
}

export async function readFlowInputs(
  inputFile: string | undefined,
  values: ReadonlyArray<string>,
  limits: FlowInputFileLimits = {}
): Promise<JsonObject[]> {
  if (inputFile === undefined) {
    return [parseInputFlags(values)];
  }
  try {
    const content =
      limits.maxBytes === undefined
        ? await readFile(inputFile, 'utf8')
        : await readBoundedInputFile(inputFile, limits.maxBytes);
    return parseInputDocument(content, limits);
  } catch (error: unknown) {
    const detail = error instanceof RangeError ? ` ${error.message}` : '';
    throw flowInputInvalid(`Could not read valid Flow inputs from "${inputFile}".${detail}`, error);
  }
}

async function readBoundedInputFile(inputFile: string, maxBytes: number): Promise<string> {
  const handle = await open(inputFile, 'r');
  try {
    const snapshot = await handle.stat();
    if (snapshot.size > maxBytes) {
      throw new RangeError(`The input file exceeds the plugin safety limit of ${maxBytes} bytes.`);
    }
    const content = await handle.readFile('utf8');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      throw new RangeError(`The input file exceeds the plugin safety limit of ${maxBytes} bytes.`);
    }
    return content;
  } finally {
    await handle.close();
  }
}
