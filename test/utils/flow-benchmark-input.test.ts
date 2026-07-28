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

import { MAX_BENCHMARK_INPUT_FILE_BYTES } from '../../src/utils/flow-benchmark-flags.js';
import { readFlowBenchmarkInputs } from '../../src/utils/flow-benchmark-input.js';

describe('Flow benchmark input boundaries', (): void => {
  it('rejects an oversized file before reading and parsing it', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-input-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, '[]');
      await truncate(inputFile, MAX_BENCHMARK_INPUT_FILE_BYTES + 1);
      const error = await readFlowBenchmarkInputs(inputFile, []).catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowInputInvalid');
      expect(error).to.have.property('message').that.includes('cannot exceed 10485760 bytes');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
