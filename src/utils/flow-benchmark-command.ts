/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Org } from '@salesforce/core';

import type { FlowBenchmarkRequest } from '../types/flow-benchmark.js';
import type { FlowDebugLogLevel } from '../types/flow-debug.js';
import { createNamedFlowRequest, type createFlowCommandContext } from './flow-command.js';
import type { FlowBenchmarkDestinations } from './flow-benchmark-files.js';
import { readFlowBenchmarkInputs } from './flow-benchmark-input.js';

export interface BenchmarkFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  input: string[];
  'input-file': string | undefined;
  iterations: number;
  warmup: number;
  concurrency: number;
  percentile: number[];
  'continue-on-error': boolean;
  'include-failed': boolean;
  'raw-log-dir': string | undefined;
  'exclude-warmup-logs': boolean;
  'output-file': string | undefined;
  'dry-run': boolean;
  confirm: boolean;
  'log-level': FlowDebugLogLevel;
  wait: number;
  'if-active-version': number | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

export async function createFlowBenchmarkRequest(
  flags: BenchmarkFlagValues,
  context: ReturnType<typeof createFlowCommandContext>,
  destinations: FlowBenchmarkDestinations
): Promise<FlowBenchmarkRequest> {
  return {
    ...createNamedFlowRequest(flags, context),
    inputs: await readFlowBenchmarkInputs(flags['input-file'], flags.input),
    iterations: flags.iterations,
    warmup: flags.warmup,
    concurrency: flags.concurrency,
    percentiles: [...new Set(flags.percentile)].sort((left, right) => left - right),
    continueOnError: flags['continue-on-error'],
    includeFailed: flags['include-failed'],
    dryRun: flags['dry-run'],
    confirm: flags.confirm,
    logLevel: flags['log-level'],
    waitMilliseconds: flags.wait * 60_000,
    retainWarmupLogs: !flags['exclude-warmup-logs'],
    ...(destinations.rawLogDir === undefined ? {} : { rawLogDirectory: destinations.rawLogDir }),
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
  };
}
