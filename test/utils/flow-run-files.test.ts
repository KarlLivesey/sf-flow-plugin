/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { persistFlowRunFiles, prepareFlowRunFiles } from '../../src/utils/flow-run-files.js';
import { flowRunResult } from '../helpers/flow-run-command-fixtures.js';

async function expectOwnerOnly(file: string): Promise<void> {
  if (process.platform !== 'win32') {
    expect((await stat(file)).mode & 0o077).to.equal(0);
  }
}

describe('Flow run file destination identity', (): void => {
  it('rejects different paths that identify the same hard-linked file', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-run-files-'));
    const outputFile = join(directory, 'result.json');
    const rawLogFile = join(directory, 'debug.log');
    try {
      await writeFile(outputFile, 'existing', 'utf8');
      await link(outputFile, rawLogFile);
      const error = await prepareFlowRunFiles(outputFile, rawLogFile).catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowInputInvalid');
      expect(error).to.have.property('message', '--output-file and --raw-log-file must identify different files.');
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects destination names that collide on case-insensitive filesystems', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-run-case-'));
    try {
      const error = await prepareFlowRunFiles(join(directory, 'result.json'), join(directory, 'RESULT.json')).catch(
        (caught: unknown) => caught
      );
      expect(error).to.have.property('name', 'FlowInputInvalid');
      expect(error).to.have.property('message').that.includes('must not differ only by case');
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('writes separate structured and raw-log artifacts after execution', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-run-write-'));
    const outputFile = join(directory, 'nested', 'result.json');
    const rawLogFile = join(directory, 'logs', 'debug.log');
    try {
      const destinations = await prepareFlowRunFiles(outputFile, rawLogFile);
      await persistFlowRunFiles(destinations, { result: flowRunResult, rawLog: 'complete debug log' });
      expect(await readFile(outputFile, 'utf8')).to.equal(`${JSON.stringify(flowRunResult, null, 2)}\n`);
      expect(await readFile(rawLogFile, 'utf8')).to.equal('complete debug log\n');
      await expectOwnerOnly(rawLogFile);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
