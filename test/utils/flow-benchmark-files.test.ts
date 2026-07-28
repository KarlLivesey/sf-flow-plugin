/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import type { FlowBenchmarkArtifact } from '../../src/types/flow-benchmark.js';
import { persistFlowBenchmark, prepareFlowBenchmarkDestinations } from '../../src/utils/flow-benchmark-files.js';

const result: FlowBenchmarkArtifact['result'] = {
  apiName: 'Calculate_Discount',
  namespace: null,
  definitionId: '300000000000001',
  version: 1,
  targetOrg: 'admin@example.com',
  production: false,
  dryRun: false,
  successful: true,
  iterations: 1,
  warmup: 1,
  requestedConcurrency: 1,
  effectiveConcurrency: 1,
  completedSamples: 2,
  failedSamples: 0,
  includedSamples: 1,
  totalWallClockMilliseconds: 10,
  throughputPerSecond: 100,
  wallClock: null,
  cpuTime: null,
  samples: [],
};

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function expectOwnerOnly(file: string): Promise<void> {
  if (process.platform !== 'win32') {
    expect((await stat(file)).mode & 0o077).to.equal(0);
  }
}

describe('Flow benchmark files', (): void => {
  it('writes owner-only Apex logs and can exclude warm-up logs', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-'));
    const logDirectory = join(directory, 'nested', 'logs');
    try {
      const destinations = await prepareFlowBenchmarkDestinations(undefined, logDirectory, true);
      await persistFlowBenchmark(destinations, {
        result,
        rawLogs: [
          { phase: 'warmup', sample: 1, rawLog: 'warmup log' },
          { phase: 'measured', sample: 1, rawLog: 'measured log' },
        ],
      });
      const measured = join(logDirectory, 'measured-000001.log');
      expect(await readFile(measured, 'utf8')).to.equal('measured log\n');
      expect(await exists(join(logDirectory, 'warmup-000001.log'))).to.equal(false);
      await expectOwnerOnly(measured);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('does not create a raw-log directory during dry-run persistence', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-dry-'));
    const logDirectory = join(directory, 'logs');
    try {
      const destinations = await prepareFlowBenchmarkDestinations(undefined, logDirectory, false);
      await persistFlowBenchmark(destinations, { result: { ...result, dryRun: true, successful: null }, rawLogs: [] });
      expect(await exists(logDirectory)).to.equal(false);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('rejects output and raw-log destinations that contain one another', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-overlap-'));
    try {
      const logDirectory = join(directory, 'logs');
      const error = await prepareFlowBenchmarkDestinations(
        join(logDirectory, 'result.json'),
        logDirectory,
        false
      ).catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowBenchmarkFailed');
      expect(error).to.have.property('message', '--output-file and --raw-log-dir must not contain one another.');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
