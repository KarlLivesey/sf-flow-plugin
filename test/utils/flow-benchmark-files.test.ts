/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { chmodSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import type { FlowBenchmarkArtifact } from '../../src/types/flow-benchmark.js';
import {
  createFlowBenchmarkLogStage,
  createFlowBenchmarkRawLogWriter,
  prepareFlowBenchmarkDestinations,
  writeFlowBenchmarkRawLog,
} from '../../src/utils/flow-benchmark-files.js';
import {
  persistFlowBenchmark,
  retainedBenchmarkRecoveryPaths,
} from '../../src/utils/flow-benchmark-output-transaction.js';

const result: FlowBenchmarkArtifact['result'] = {
  apiName: 'Calculate_Discount',
  namespace: null,
  definitionId: '300000000000001',
  version: 1,
  targetOrg: 'admin@example.com',
  production: false,
  dryRun: false,
  logLevel: 'detailed',
  successful: true,
  iterations: 1,
  warmup: 1,
  requestedConcurrency: 1,
  effectiveConcurrency: 1,
  sampleTimeoutMilliseconds: 120_000,
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

function invalidBenchmarkResult(directory: string): FlowBenchmarkArtifact['result'] {
  const circular: unknown[] = [];
  circular.push(circular);
  const invalidResult = { ...result };
  Object.defineProperty(invalidResult, 'samples', {
    enumerable: true,
    get: (): unknown[] => {
      chmodSync(directory, 0o500);
      return circular;
    },
  });
  return invalidResult;
}

async function retainedWriteFailure(directory: string): Promise<unknown> {
  try {
    return await persistFlowBenchmark(
      { outputFile: join(directory, 'result.json'), rawLogDir: undefined, excludeWarmupLogs: false },
      { result: invalidBenchmarkResult(directory), rawLogStage: null }
    ).catch((caught: unknown) => caught);
  } finally {
    await chmod(directory, 0o700);
  }
}

function expectAggregateRecoveryCause(error: unknown): void {
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause).to.be.instanceOf(AggregateError);
  expect((cause as AggregateError).errors).to.have.length.greaterThan(1);
  expect((cause as AggregateError).errors[0])
    .to.have.property('message')
    .that.includes('circular');
}

describe('Flow benchmark files', (): void => {
  it('writes owner-only debug logs and can exclude warm-up logs', async (): Promise<void> => {
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

  it('drains a backpressured raw-log queue without dropping samples', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-queue-'));
    try {
      const writer = createFlowBenchmarkRawLogWriter(directory);
      await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          writer.enqueue({ phase: 'measured', sample: index + 1, rawLog: `log ${index + 1}` })
        )
      );
      await writer.drain();
      expect(await readdir(directory)).to.have.length(40);
    } finally {
      await rm(directory, { recursive: true, force: true });
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

  it('reports only a surviving raw-log stage after raw cleanup alone fails', async (): Promise<void> => {
    const retained = await retainedBenchmarkRecoveryPaths(['/staging/structured', '/staging/raw'], (file) =>
      Promise.resolve(file.endsWith('/raw'))
    );
    expect(retained).to.deep.equal(['/staging/raw']);
  });

  it('reports only a surviving structured stage after structured rollback alone fails', async (): Promise<void> => {
    const retained = await retainedBenchmarkRecoveryPaths(['/staging/structured', '/staging/raw'], (file) =>
      Promise.resolve(file.endsWith('/structured'))
    );
    expect(retained).to.deep.equal(['/staging/structured']);
  });

  it('reports every surviving stage when both recovery operations fail', async (): Promise<void> => {
    const retained = await retainedBenchmarkRecoveryPaths(['/staging/structured', '/staging/raw'], () =>
      Promise.resolve(true)
    );
    expect(retained).to.deep.equal(['/staging/structured', '/staging/raw']);
  });
});

describe('Flow benchmark staged-write recovery', (): void => {
  it('preserves a staged-write failure and reports its retained stage when cleanup also fails', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-benchmark-write-failure-'));
    const error = await retainedWriteFailure(directory);
    try {
      expect(error).to.have.property('name', 'FlowBenchmarkFailed');
      expect(error).to.have.property('message').that.includes('recovery was incomplete');
      expectAggregateRecoveryCause(error);
      expect((await readdir(directory)).some((entry) => entry.startsWith('.sf-flow-benchmark-output-'))).to.equal(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
