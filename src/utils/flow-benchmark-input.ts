/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { stat } from 'node:fs/promises';

import { flowInputInvalid } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';
import { MAX_BENCHMARK_INPUT_FILE_BYTES, MAX_BENCHMARK_INPUTS } from './flow-benchmark-flags.js';
import { readFlowInputs } from './flow-input-file.js';

async function assertBenchmarkInputFileSize(inputFile: string): Promise<void> {
  try {
    const size = (await stat(inputFile)).size;
    if (size > MAX_BENCHMARK_INPUT_FILE_BYTES) {
      throw flowInputInvalid(
        `Flow benchmark input file cannot exceed ${MAX_BENCHMARK_INPUT_FILE_BYTES} bytes (received ${size}).`
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowInputInvalid') {
      throw error;
    }
    throw flowInputInvalid(`Could not inspect Flow benchmark input file "${inputFile}".`, error);
  }
}

export async function readFlowBenchmarkInputs(
  inputFile: string | undefined,
  values: ReadonlyArray<string>
): Promise<JsonObject[]> {
  if (inputFile !== undefined) {
    await assertBenchmarkInputFileSize(inputFile);
  }
  const inputs = await readFlowInputs(inputFile, values);
  if (inputs.length > MAX_BENCHMARK_INPUTS) {
    throw flowInputInvalid(`Flow benchmark input file cannot contain more than ${MAX_BENCHMARK_INPUTS} objects.`);
  }
  return inputs;
}
