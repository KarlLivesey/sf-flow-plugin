/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowBenchmarkService } from '../../src/services/flow-benchmark-service.js';
import { flowBenchmarkGateways, flowBenchmarkRequest } from '../helpers/flow-benchmark-fixtures.js';

describe('FlowBenchmarkService successful measurements', (): void => {
  it('runs warm-up first, assigns varied inputs round-robin and excludes warm-up statistics', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    const artifact = await new FlowBenchmarkService(gateways).benchmark(
      flowBenchmarkRequest({ concurrency: 2, iterations: 4, warmup: 1 })
    );

    expect(gateways.benchmark.opened).to.have.length(1);
    expect(gateways.benchmark.session.closed).to.equal(true);
    expect(gateways.benchmark.session.executed.map((request) => request.input)).to.deep.equal([
      { percentage: 10 },
      { percentage: 10 },
      { percentage: 20 },
      { percentage: 10 },
      { percentage: 20 },
    ]);
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
    expect(artifact.rawLogs).to.have.length(5);
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
    expect(artifact.rawLogs).to.have.length(3);
  });
});

describe('FlowBenchmarkService dry run', (): void => {
  it('validates every varied input without opening a tracing session', async (): Promise<void> => {
    const gateways = flowBenchmarkGateways();
    const artifact = await new FlowBenchmarkService(gateways).benchmark(flowBenchmarkRequest({ dryRun: true }));

    expect(gateways.benchmark.opened).to.deep.equal([]);
    expect(artifact.rawLogs).to.deep.equal([]);
    expect(artifact.result).to.include({
      dryRun: true,
      successful: null,
      completedSamples: 0,
      totalWallClockMilliseconds: 0,
    });
  });
});
