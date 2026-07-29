/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowBenchmarkRequest, FlowBenchmarkResult, FlowBenchmarkSample } from '../types/flow-benchmark.js';
import type { PreparedFlowDebug } from './flow-debug-result.js';
import { calculateBenchmarkStatistics } from './flow-benchmark-statistics.js';

interface BenchmarkResultContext {
  request: FlowBenchmarkRequest;
  prepared: PreparedFlowDebug;
  samples: FlowBenchmarkSample[];
  totalWallClockMilliseconds: number;
  measuredWallClockMilliseconds: number;
}

export function createFlowBenchmarkResult(context: BenchmarkResultContext): FlowBenchmarkResult {
  const { request, prepared, samples, totalWallClockMilliseconds, measuredWallClockMilliseconds } = context;
  const measured = samples.filter((sample) => sample.phase === 'measured');
  const included = measured.filter((sample) => sample.successful || request.includeFailed);
  const cpuValues = included
    .map((sample) => sample.cpuTimeMilliseconds)
    .filter((value): value is number => value !== null);
  const failedSamples = samples.filter((sample) => !sample.successful).length;
  return {
    apiName: prepared.flow.definition.apiName,
    namespace: prepared.flow.definition.namespace,
    definitionId: prepared.flow.definition.id,
    version: prepared.flow.version.versionNumber,
    targetOrg: request.targetOrg,
    production: prepared.production,
    dryRun: request.dryRun,
    logLevel: request.logLevel,
    successful: request.dryRun ? null : measured.length === request.iterations && failedSamples === 0,
    iterations: request.iterations,
    warmup: request.warmup,
    requestedConcurrency: request.concurrency,
    effectiveConcurrency: Math.min(request.concurrency, request.iterations),
    sampleTimeoutMilliseconds: request.sampleTimeoutMilliseconds,
    completedSamples: samples.length,
    failedSamples,
    includedSamples: included.length,
    totalWallClockMilliseconds,
    measuredWallClockMilliseconds,
    throughputPerSecond:
      request.dryRun || measuredWallClockMilliseconds === 0
        ? null
        : measured.length / (measuredWallClockMilliseconds / 1000),
    wallClock: calculateBenchmarkStatistics(
      included.map((sample) => sample.wallClockMilliseconds).filter((value): value is number => value !== null),
      request.percentiles
    ),
    cpuTime: calculateBenchmarkStatistics(cpuValues, request.percentiles),
    samples,
  };
}
