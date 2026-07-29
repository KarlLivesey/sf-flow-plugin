/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { FlowBenchmarkService } from '../../src/services/flow-benchmark-service.js';
import type { FlowBenchmarkArtifact } from '../../src/types/flow-benchmark.js';
import { flowBenchmarkGateways, flowBenchmarkRequest } from '../helpers/flow-benchmark-fixtures.js';

function expectSuccessfulMeasurements(artifact: FlowBenchmarkArtifact): void {
  expect(artifact.result).to.include({
    successful: true,
    completedSamples: 5,
    includedSamples: 4,
    requestedConcurrency: 2,
    effectiveConcurrency: 2,
  });
  expect(artifact.result.wallClock).to.deep.include({ count: 4, minimum: 10, maximum: 25, mean: 17.5 });
  expect(artifact.result.cpuTime).to.deep.include({ count: 4, minimum: 20, maximum: 50, mean: 35 });
  expect(artifact.result.wallClock?.percentiles).to.deep.equal([
    { percentile: 50, value: 15 },
    { percentile: 90, value: 25 },
    { percentile: 95, value: 25 },
    { percentile: 99, value: 25 },
  ]);
  expect(artifact.result.throughputPerSecond).to.equal(4 / (artifact.result.measuredWallClockMilliseconds / 1000));
}

describe('FlowBenchmarkService successful measurements', (): void => {
  it('runs warm-up first, assigns varied inputs round-robin and excludes warm-up statistics', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    const artifact = await new FlowBenchmarkService(gateways).benchmark(
      flowBenchmarkRequest({ concurrency: 2, iterations: 4, warmup: 1 })
    );

    expect(gateways.benchmark.opened[0]).to.include({
      executionCoverageMilliseconds: 600_000,
      traceDurationMilliseconds: 780_000,
    });
    expect(gateways.benchmark.session).to.include({ closed: true, preparedBatches: 3 });
    expect(gateways.benchmark.session.executed.map((request) => request.input)).to.deep.equal([
      { percentage: 10 },
      { percentage: 10 },
      { percentage: 20 },
      { percentage: 10 },
      { percentage: 20 },
    ]);
    expectSuccessfulMeasurements(artifact);
    expect(artifact.rawLogStage).to.equal(null);
  });
});

describe('FlowBenchmarkService raw log staging', (): void => {
  it('streams requested logs to staging without publishing the destination', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-service-benchmark-'));
    const destination = join(directory, 'logs');
    try {
      const artifact = await new FlowBenchmarkService(flowBenchmarkGateways()).benchmark(
        flowBenchmarkRequest({ iterations: 1, warmup: 1, rawLogDirectory: destination })
      );
      expect(artifact.rawLogStage).to.be.a('string');
      expect(await readdir(artifact.rawLogStage ?? '')).to.deep.equal(['measured-000001.log', 'warmup-000001.log']);
      const published = await readdir(destination).then(
        () => true,
        () => false
      );
      expect(published).to.equal(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drains every claimed execution before a raw-log write failure closes the session', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-service-drain-'));
    const gateways = flowBenchmarkGateways();
    let secondExecutionFinished = false;
    gateways.benchmark.session.onExecute = async (sample): Promise<void> => {
      if (sample === 1) {
        const stage = (await readdir(directory)).find((entry) => entry.startsWith('.sf-flow-benchmark-'));
        await rm(join(directory, stage ?? 'missing-stage'), { recursive: true, force: true });
      } else {
        await wait(20);
        secondExecutionFinished = true;
      }
    };
    try {
      const error = await new FlowBenchmarkService(gateways)
        .benchmark(
          flowBenchmarkRequest({ iterations: 2, warmup: 0, concurrency: 2, rawLogDirectory: join(directory, 'logs') })
        )
        .catch((caught: unknown) => caught);
      expect(error).to.have.property('name', 'FlowBenchmarkFailed');
      expect(secondExecutionFinished).to.equal(true);
      expect(gateways.benchmark.session.closed).to.equal(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('FlowBenchmarkService failed measurements', (): void => {
  it('stops scheduling after failure by default and always restores the tracing session', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    gateways.benchmark.session.failAt = 2;
    const artifact = await new FlowBenchmarkService(gateways).benchmark(
      flowBenchmarkRequest({ iterations: 4, warmup: 0 })
    );

    expect(gateways.benchmark.session.executed).to.have.length(2);
    expect(gateways.benchmark.session.closed).to.equal(true);
    expect(artifact.result).to.include({
      successful: false,
      completedSamples: 2,
      failedSamples: 1,
      includedSamples: 1,
    });
    expect(artifact.result.samples[1]).to.deep.include({
      successful: false,
      wallClockMilliseconds: null,
      cpuTimeMilliseconds: null,
      errorCode: 'FlowBenchmarkFailed',
    });
  });

  it('continues after failures and includes failed timings only when requested', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    gateways.benchmark.session.malformedAt = 2;
    const artifact = await new FlowBenchmarkService(gateways).benchmark(
      flowBenchmarkRequest({ iterations: 3, warmup: 0, continueOnError: true, includeFailed: true })
    );

    expect(gateways.benchmark.session.executed).to.have.length(3);
    expect(artifact.result).to.include({ successful: false, failedSamples: 1, includedSamples: 3 });
    expect(artifact.result.wallClock).to.deep.include({ count: 3, minimum: 5, maximum: 15, mean: 10 });
    expect(artifact.result.cpuTime).to.deep.include({ count: 2, minimum: 10, maximum: 30, mean: 20 });
    expect(artifact.rawLogStage).to.equal(null);
  });
});

describe('FlowBenchmarkService concurrent ordering', (): void => {
  it('returns warm-up samples in planned order after a concurrent wave stops on failure', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    gateways.benchmark.session.failAt = 1;
    gateways.benchmark.session.onExecute = async (sample): Promise<void> => {
      await wait(sample === 1 ? 20 : 0);
    };
    const artifact = await new FlowBenchmarkService(gateways).benchmark(
      flowBenchmarkRequest({ iterations: 1, warmup: 4, concurrency: 2 })
    );
    expect(artifact.result.samples.map((sample) => sample.sample)).to.deep.equal([1, 2]);
    expect(artifact.result.samples.map((sample) => sample.phase)).to.deep.equal(['warmup', 'warmup']);
    expect(gateways.benchmark.session.executed).to.have.length(2);
  });
});

describe('FlowBenchmarkService dry run', (): void => {
  it('validates every varied input without opening a tracing session', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    const artifact = await new FlowBenchmarkService(gateways).benchmark(flowBenchmarkRequest({ dryRun: true }));

    expect(gateways.benchmark.opened).to.deep.equal([]);
    expect(artifact.rawLogStage).to.equal(null);
    expect(artifact.result).to.include({
      dryRun: true,
      successful: null,
      completedSamples: 0,
      totalWallClockMilliseconds: 0,
    });
  });

  it('rejects mixed-version measurements when activation changes during the measured phase', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    gateways.benchmark.session.onExecute = async (sample): Promise<void> => {
      if (sample === 3) {
        await gateways.definition.setActiveVersion('300000000000001', null);
      }
    };
    const error = await new FlowBenchmarkService(gateways)
      .benchmark(flowBenchmarkRequest({ iterations: 2, warmup: 1 }))
      .catch((caught: unknown) => caught);

    expect(error).to.have.property('name', 'FlowBenchmarkFailed');
    expect(error).to.have.property('message').that.includes('active version changed after measured sampling');
    expect(gateways.benchmark.session.closed).to.equal(true);
  });

  it('revalidates activation after warm-up and before scheduling measured samples', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    gateways.benchmark.session.onExecute = async (sample): Promise<void> => {
      if (sample === 1) {
        await gateways.definition.setActiveVersion('300000000000001', null);
      }
    };
    const error = await new FlowBenchmarkService(gateways)
      .benchmark(flowBenchmarkRequest({ iterations: 2, warmup: 1 }))
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('message').that.includes('active version changed before measured sampling');
    expect(gateways.benchmark.session.executed).to.have.length(1);
  });
});
