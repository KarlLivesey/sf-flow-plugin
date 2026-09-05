/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { FlowBenchmarkService } from '../../src/services/flow-benchmark-service.js';
import { prepareBenchmarkStream, withBenchmarkStream } from '../../src/utils/flow-benchmark-stream.js';
import { flowBenchmarkGateways, flowBenchmarkRequest } from '../helpers/flow-benchmark-fixtures.js';

async function verifyStreaming(directory: string): Promise<void> {
  const file = join(directory, 'samples.jsonl');
  const request = flowBenchmarkRequest();
  const artifact = await withBenchmarkStream({ file, dryRun: false }, async (control) =>
    new FlowBenchmarkService(flowBenchmarkGateways()).benchmark(request, undefined, control)
  );
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  expect(lines).to.have.length(request.iterations + request.warmup + 1);
  expect(artifact.result.samples).to.deep.equal([]);
  expect(artifact.result.completedSamples).to.equal(5);
  expect(artifact.result.cpuTime?.count).to.equal(4);
  expect(artifact.result.cpuTime?.maximum).to.equal(50);
  expect(lines.at(-1)).to.include('"type":"summary"');
}

async function verifyInterruption(): Promise<void> {
  const controller = new AbortController();
  const gateways = flowBenchmarkGateways();
  gateways.benchmark.onExecute = async (): Promise<void> => {
    controller.abort();
    await Promise.resolve();
  };
  const artifact = await new FlowBenchmarkService(gateways).benchmark(
    flowBenchmarkRequest({ warmup: 0, iterations: 100 }),
    undefined,
    { signal: controller.signal }
  );
  expect(gateways.benchmark.executed).to.have.length(1);
  expect(artifact.result).to.include({ interrupted: true, successful: false, completedSamples: 1 });
}

async function verifyDryRun(directory: string): Promise<void> {
  const file = join(directory, 'samples.jsonl');
  await prepareBenchmarkStream(file, { outputFile: undefined, rawLogDir: undefined, excludeWarmupLogs: false });
  await withBenchmarkStream({ file, dryRun: true }, async (control) =>
    new FlowBenchmarkService(flowBenchmarkGateways()).benchmark(
      flowBenchmarkRequest({ dryRun: true }),
      undefined,
      control
    )
  );
  expect(await access(file).catch((error: unknown) => error)).to.have.property('code', 'ENOENT');
}

async function verifySignalCleanup(directory: string): Promise<void> {
  const file = join(directory, 'samples.jsonl');
  const listeners = process.listenerCount('SIGINT');
  const existing = new Set(process.listeners('SIGINT'));
  const gateways = flowBenchmarkGateways();
  gateways.benchmark.onExecute = async (): Promise<void> => {
    process
      .listeners('SIGINT')
      .filter((listener) => !existing.has(listener))
      .forEach((listener) => {
        listener('SIGINT');
      });
    await Promise.resolve();
  };
  const artifact = await withBenchmarkStream({ file, dryRun: false }, async (control) =>
    new FlowBenchmarkService(gateways).benchmark(flowBenchmarkRequest({ warmup: 0 }), undefined, control)
  );
  expect(artifact.result.interrupted).to.equal(true);
  expect((await readFile(file, 'utf8')).split('\n')[0]).to.include('"type":"sample"');
  expect(process.listenerCount('SIGINT')).to.equal(listeners);
}

describe('benchmark streaming and cancellation', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow measurements '));
  });
  afterEach(async (): Promise<void> => rm(directory, { recursive: true, force: true }));

  it('streams each sample and keeps exact statistics without retaining records', async (): Promise<void> =>
    verifyStreaming(directory));

  it('stops scheduling after interruption and preserves completed samples', async (): Promise<void> =>
    verifyInterruption());

  it('validates a dry-run stream path without creating the file', async (): Promise<void> => verifyDryRun(directory));

  it('preserves completed JSONL records on failure and removes the signal handler', async (): Promise<void> =>
    verifySignalCleanup(directory));
});
