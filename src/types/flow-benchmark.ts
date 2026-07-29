/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from './flow-analysis.js';
import type { FlowDebugExecutionRequest, FlowDebugLogLevel, FlowDebugTransportResult } from './flow-debug.js';
import type { FlowVersionNumber, NamedFlowRequest } from './flow.js';

export type FlowBenchmarkPhase = 'warmup' | 'measured';

export interface FlowBenchmarkRequest extends NamedFlowRequest {
  inputs: JsonObject[];
  iterations: number;
  warmup: number;
  concurrency: number;
  percentiles: number[];
  continueOnError: boolean;
  includeFailed: boolean;
  dryRun: boolean;
  confirm: boolean;
  logLevel: FlowDebugLogLevel;
  rawLogDirectory?: string;
  retainWarmupLogs: boolean;
  expectedActiveVersion?: FlowVersionNumber;
}

export interface FlowBenchmarkGateway {
  execute(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkTransportSample>;
}

export interface FlowBenchmarkTransportSample {
  transport: FlowDebugTransportResult;
  wallClockMilliseconds: number;
}

export interface FlowBenchmarkPercentile {
  percentile: number;
  value: number;
}

export interface FlowBenchmarkStatistics {
  count: number;
  minimum: number;
  maximum: number;
  mean: number;
  percentiles: FlowBenchmarkPercentile[];
}

export interface FlowBenchmarkSample {
  sample: number;
  phase: FlowBenchmarkPhase;
  inputIndex: number;
  successful: boolean;
  rollbackConfirmed: boolean;
  wallClockMilliseconds: number | null;
  cpuTimeMilliseconds: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface FlowBenchmarkResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  version: FlowVersionNumber;
  targetOrg: string;
  production: boolean;
  dryRun: boolean;
  logLevel: FlowDebugLogLevel;
  successful: boolean | null;
  iterations: number;
  warmup: number;
  requestedConcurrency: number;
  effectiveConcurrency: number;
  completedSamples: number;
  failedSamples: number;
  includedSamples: number;
  totalWallClockMilliseconds: number;
  measuredWallClockMilliseconds: number;
  throughputPerSecond: number | null;
  wallClock: FlowBenchmarkStatistics | null;
  cpuTime: FlowBenchmarkStatistics | null;
  samples: FlowBenchmarkSample[];
}

export interface FlowBenchmarkArtifact {
  result: FlowBenchmarkResult;
  rawLogStage: string | null;
}
