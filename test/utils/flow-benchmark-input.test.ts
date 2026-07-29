/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { readFlowBenchmarkInputs } from '../../src/utils/flow-benchmark-input.js';
import { MAX_BENCHMARK_INPUT_FILE_BYTES, MAX_BENCHMARK_INPUTS } from '../../src/utils/flow-benchmark-flags.js';

describe('Flow benchmark input boundaries', (): void => {
  it('rejects more than the product input-object limit', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-input-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, JSON.stringify(Array.from({ length: MAX_BENCHMARK_INPUTS + 1 }, () => ({}))));
      const error = await readFlowBenchmarkInputs(inputFile, []).catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowInputInvalid');
      expect(error).to.have.property('message').that.includes(`${MAX_BENCHMARK_INPUTS} input objects`);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects an input file larger than the product byte limit before parsing', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-input-size-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, '[]');
      await truncate(inputFile, MAX_BENCHMARK_INPUT_FILE_BYTES + 1);
      const error = await readFlowBenchmarkInputs(inputFile, []).catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowInputInvalid');
      expect(error).to.have.property('message').that.includes(`${MAX_BENCHMARK_INPUT_FILE_BYTES} bytes`);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
