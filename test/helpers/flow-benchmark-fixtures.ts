/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type {
  FlowBenchmarkRequest,
  FlowBenchmarkSession,
  FlowBenchmarkSessionGateway,
  FlowBenchmarkSessionRequest,
  FlowBenchmarkTransportSample,
} from '../../src/types/flow-benchmark.js';
import type { FlowDebugExecutionRequest } from '../../src/types/flow-debug.js';
import { correlationId, debugLog, flowDebugGateways } from './flow-debug-fixtures.js';

export class FakeBenchmarkSession implements FlowBenchmarkSession {
  public readonly executed: FlowDebugExecutionRequest[] = [];
  public closed = false;
  public failAt: number | undefined;
  public malformedAt: number | undefined;
  public preparedBatches = 0;
  public onExecute: ((sample: number) => Promise<void>) | undefined;

  public async close(): Promise<void> {
    this.closed = true;
  }

  public async execute(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkTransportSample> {
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
        execution: { compiled: true, success: true, line: -1, column: -1 },
        log: {
          id: `07L${String(sample).padStart(12, '0')}`,
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

  public async prepareBatch(): Promise<void> {
    this.preparedBatches += 1;
  }
}

export class FakeBenchmarkGateway implements FlowBenchmarkSessionGateway {
  public readonly session = new FakeBenchmarkSession();
  public opened: FlowBenchmarkSessionRequest[] = [];

  public async open(request: FlowBenchmarkSessionRequest): Promise<FlowBenchmarkSession> {
    this.opened.push(request);
    return this.session;
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
    percentiles: [50, 90, 95, 99],
    continueOnError: false,
    includeFailed: false,
    dryRun: false,
    confirm: false,
    logLevel: 'detailed',
    waitMilliseconds: 120_000,
    retainWarmupLogs: true,
    ...overrides,
  };
}
