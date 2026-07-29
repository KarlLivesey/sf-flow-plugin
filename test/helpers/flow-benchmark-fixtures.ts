/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type {
  FlowBenchmarkExecutionRequest,
  FlowBenchmarkGateway,
  FlowBenchmarkRequest,
  FlowBenchmarkTransportSample,
} from '../../src/types/flow-benchmark.js';
import { correlationId, debugLog, flowDebugGateways } from './flow-debug-fixtures.js';

export class FakeBenchmarkGateway implements FlowBenchmarkGateway {
  public readonly executed: FlowBenchmarkExecutionRequest[] = [];
  public failAt: number | undefined;
  public malformedAt: number | undefined;
  public onExecute: ((sample: number) => Promise<void>) | undefined;

  public async execute(request: FlowBenchmarkExecutionRequest): Promise<FlowBenchmarkTransportSample> {
    this.executed.push(request);
    const sample = this.executed.length;
    await this.onExecute?.(sample);
    if (sample === this.failAt) {
      throw new Error('sensitive benchmark failure');
    }
    const sampleCorrelation = `12345678-1234-1234-1234-${String(sample).padStart(12, '0')}`;
    const rawLog =
      sample === this.malformedAt
        ? 'malformed complete Salesforce log'
        : `${debugLog().replaceAll(correlationId, sampleCorrelation)}\nMaximum CPU time: ${sample * 10} out of 10000`;
    return {
      wallClockMilliseconds: sample * 5,
      transport: {
        correlationId: sampleCorrelation,
        execution: {
          compiled: true,
          success: true,
          line: -1,
          column: -1,
          compileProblem: null,
          exceptionMessage: null,
          exceptionStackTrace: null,
        },
        log: {
          id: null,
          status: 'Success',
          operation: 'executeAnonymous',
          startTime: '2026-07-28T10:00:00.000Z',
          durationMilliseconds: sample * 5,
          logLength: rawLog.length,
        },
        rawLog,
      },
    };
  }
}

export function flowBenchmarkGateways(): ReturnType<typeof flowDebugGateways> & {
  benchmark: FakeBenchmarkGateway;
} {
  return { ...flowDebugGateways(), benchmark: new FakeBenchmarkGateway() };
}

export function flowBenchmarkRequest(overrides: Partial<FlowBenchmarkRequest> = {}): FlowBenchmarkRequest {
  return {
    apiName: 'Calculate_Discount',
    targetOrg: 'admin@example.com',
    inputs: [{ percentage: '10' }, { percentage: '20' }],
    iterations: 4,
    warmup: 1,
    concurrency: 1,
    sampleTimeoutMilliseconds: 120_000,
    percentiles: [50, 90, 95, 99],
    continueOnError: false,
    includeFailed: false,
    dryRun: false,
    confirm: false,
    logLevel: 'detailed',
    retainWarmupLogs: true,
    ...overrides,
  };
}
