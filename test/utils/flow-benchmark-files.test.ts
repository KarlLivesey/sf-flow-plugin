/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import type { FlowBenchmarkArtifact } from '../../src/types/flow-benchmark.js';
import {
  createFlowBenchmarkLogStage,
  prepareFlowBenchmarkDestinations,
  writeFlowBenchmarkRawLog,
} from '../../src/utils/flow-benchmark-files.js';
import { persistFlowBenchmark } from '../../src/utils/flow-benchmark-output-transaction.js';

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
  measuredWallClockMilliseconds: 10,
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

async function writeMeasuredLog(
  destinations: Awaited<ReturnType<typeof prepareFlowBenchmarkDestinations>>
): Promise<string> {
  const stage = await createFlowBenchmarkLogStage(destinations.rawLogDir);
  if (stage === null) {
    throw new Error('Expected a raw benchmark log stage.');
  }
  await writeFlowBenchmarkRawLog(stage, { phase: 'measured', sample: 1, rawLog: 'measured log' });
  await persistFlowBenchmark(destinations, { result, rawLogStage: stage });
  return destinations.rawLogDir ?? '';
}

async function createRollbackFixture(): Promise<{
  directory: string;
  destinations: Awaited<ReturnType<typeof prepareFlowBenchmarkDestinations>>;
  outputFile: string;
  stage: string | null;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-rollback-'));
  const outputFile = join(directory, 'result.json');
  const rawLogDir = join(directory, 'logs');
  await writeFile(outputFile, 'previous result\n', 'utf8');
  const destinations = await prepareFlowBenchmarkDestinations(outputFile, rawLogDir, false);
  const stage = await createFlowBenchmarkLogStage(rawLogDir);
  await mkdir(rawLogDir);
  return { directory, destinations, outputFile, stage };
}

describe('Flow benchmark files', (): void => {
  it('writes owner-only Apex logs and can exclude warm-up logs', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-'));
    const logDirectory = join(directory, 'nested', 'logs');
    try {
      const destinations = await prepareFlowBenchmarkDestinations(undefined, logDirectory, true);
      await writeMeasuredLog(destinations);
      const measured = join(logDirectory, 'measured-000001.log');
      expect(await readFile(measured, 'utf8')).to.equal('measured log\n');
      expect(await exists(join(logDirectory, 'warmup-000001.log'))).to.equal(false);
      await expectOwnerOnly(measured);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe('Flow benchmark destination safety', (): void => {
  it('does not create a raw-log directory during dry-run persistence', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-dry-'));
    const logDirectory = join(directory, 'logs');
    try {
      const destinations = await prepareFlowBenchmarkDestinations(undefined, logDirectory, false);
      await persistFlowBenchmark(destinations, {
        result: { ...result, dryRun: true, successful: null },
        rawLogStage: null,
      });
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

describe('Flow benchmark output transaction', (): void => {
  it('restores an existing structured result when raw-log publication fails', async (): Promise<void> => {
    const fixture = await createRollbackFixture();
    try {
      const error = await persistFlowBenchmark(fixture.destinations, { result, rawLogStage: fixture.stage }).catch(
        (caught: unknown) => caught
      );
      expect(error).to.have.property('name', 'FlowBenchmarkFailed');
      expect(error).to.have.property('message').that.includes('No output artifacts were committed');
      expect(await readFile(fixture.outputFile, 'utf8')).to.equal('previous result\n');
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});
