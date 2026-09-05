/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowBenchmarkRequest, FlowBenchmarkResult, FlowBenchmarkSample } from '../types/flow-benchmark.js';
import type { PreparedFlowDebug } from './flow-debug-result.js';
import { calculateBenchmarkStatistics } from './flow-benchmark-statistics.js';
import { FlowBenchmarkAccumulator } from './flow-benchmark-accumulator.js';
import { fingerprintBenchmarkInputs } from './flow-benchmark-fingerprint.js';

interface BenchmarkResultContext {
  accumulator?: FlowBenchmarkAccumulator;
  interrupted?: boolean;
  request: FlowBenchmarkRequest;
  prepared: PreparedFlowDebug;
  samples: FlowBenchmarkSample[];
  totalWallClockMilliseconds: number;
  measuredWallClockMilliseconds: number;
}

export function createFlowBenchmarkResult(context: BenchmarkResultContext): FlowBenchmarkResult {
  const { request, prepared, samples, totalWallClockMilliseconds, measuredWallClockMilliseconds } = context;
  const accumulator = context.accumulator ?? new FlowBenchmarkAccumulator(request.includeFailed);
  if (context.accumulator === undefined) {
    samples.forEach((sample) => {
      accumulator.add(sample);
    });
  }
  return {
    apiName: prepared.flow.definition.apiName,
    namespace: prepared.flow.definition.namespace,
    definitionId: prepared.flow.definition.id,
    version: prepared.flow.version.versionNumber,
    targetOrg: request.targetOrg,
    production: prepared.production,
    dryRun: request.dryRun,
    logLevel: request.logLevel,
    successful: request.dryRun
      ? null
      : accumulator.measured === request.iterations && accumulator.failed === 0 && context.interrupted !== true,
    interrupted: context.interrupted ?? false,
    inputFingerprint: fingerprintBenchmarkInputs(request.inputs),
    includeFailed: request.includeFailed,
    iterations: request.iterations,
    warmup: request.warmup,
    requestedConcurrency: request.concurrency,
    effectiveConcurrency: Math.min(request.concurrency, request.iterations),
    sampleTimeoutMilliseconds: request.sampleTimeoutMilliseconds,
    completedSamples: accumulator.completed,
    failedSamples: accumulator.failed,
    includedSamples: accumulator.included,
    totalWallClockMilliseconds,
    measuredWallClockMilliseconds,
    throughputPerSecond:
      request.dryRun || measuredWallClockMilliseconds === 0
        ? null
        : accumulator.measured / (measuredWallClockMilliseconds / 1000),
    wallClock: calculateBenchmarkStatistics(accumulator.wallClock, request.percentiles),
    cpuTime: calculateBenchmarkStatistics(accumulator.cpu, request.percentiles),
    samples,
  };
}
