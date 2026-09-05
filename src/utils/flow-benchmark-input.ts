/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import { readFlowInputs } from './flow-input-file.js';

export async function readFlowBenchmarkInputs(
  inputFile: string | undefined,
  values: ReadonlyArray<string>
): Promise<JsonObject[]> {
  return readFlowInputs(inputFile, values);
}
