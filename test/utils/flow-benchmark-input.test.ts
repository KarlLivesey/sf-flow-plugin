/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { readFlowBenchmarkInputs } from '../../src/utils/flow-benchmark-input.js';

describe('Flow benchmark input boundaries', (): void => {
  it('does not impose an input-object cap', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-input-'));
    const inputFile = join(directory, 'inputs.json');
    try {
      await writeFile(inputFile, JSON.stringify(Array.from({ length: 10_001 }, () => ({}))));
      expect(await readFlowBenchmarkInputs(inputFile, [])).to.have.length(10_001);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
