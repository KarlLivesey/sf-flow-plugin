/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';

import type {
  FlowBenchmarkExecutionRequest,
  FlowBenchmarkGateway,
  FlowBenchmarkTransportSample,
} from '../types/flow-benchmark.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { FlowBenchmarkExecutionError } from '../utils/flow-benchmark-error.js';
import { ApexSoapExecuteAnonymous, type ApexSoapExecuteResult } from './apex-soap-execute-anonymous.js';
import { isPermissionFailure, transportCodes } from './flow-debug-transport-support.js';

const TIMEOUT_CODES = new Set([
  'ABORT_ERR',
  'ERR_HTTP_REQUEST_TIMEOUT',
  'ESOCKETTIMEDOUT',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
]);

function isTimeoutFailure(error: unknown): boolean {
  return (
    transportCodes(error).some((code) => TIMEOUT_CODES.has(code)) ||
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        error.name === 'TimeoutError' ||
        /\b(?:timed?\s*out|timeout)\b/iu.test(error.message)))
  );
}

function safeErrorCode(error: unknown): string {
  if (isPermissionFailure(error)) {
    return 'FlowDebugPermissionDenied';
  }
  return error instanceof Error && /^Flow[A-Z][A-Za-z]+$/u.test(error.name) ? error.name : 'FlowBenchmarkFailed';
}

function transportSample(
  response: ApexSoapExecuteResult,
  correlationId: string,
  startedAt: string
): FlowBenchmarkTransportSample {
  return {
    wallClockMilliseconds: response.durationMilliseconds,
    transport: {
      correlationId,
      execution: response.execution,
      rawLog: response.rawLog,
      log: {
        id: null,
        status: response.execution.success ? 'Success' : 'Failed',
        operation: 'executeAnonymous',
        startTime: startedAt,
        durationMilliseconds: response.durationMilliseconds,
        logLength: Buffer.byteLength(response.rawLog, 'utf8'),
      },
    },
  };
}

function benchmarkFailure(error: unknown, started: number): never {
  if (error instanceof FlowBenchmarkExecutionError) {
    throw error;
  }
  if (isTimeoutFailure(error)) {
    throw new FlowBenchmarkExecutionError({
      errorCode: 'FlowBenchmarkSampleTimeout',
      executionDurationMilliseconds: performance.now() - started,
      safeMessage:
        'The benchmark sample exceeded its SOAP timeout; Salesforce transaction completion and rollback are unknown.',
      stopScheduling: true,
      rollbackConfirmed: null,
    });
  }
  throw new FlowBenchmarkExecutionError({
    errorCode: safeErrorCode(error),
    executionDurationMilliseconds: performance.now() - started,
    stopScheduling: true,
    rollbackConfirmed: null,
  });
}

async function executeSample(
  soap: ApexSoapExecuteAnonymous,
  context: { request: FlowBenchmarkExecutionRequest; correlationId: string; apexSource: string }
): Promise<FlowBenchmarkTransportSample> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    return transportSample(
      await soap.execute({
        apexSource: context.apexSource,
        logLevel: context.request.logLevel,
        timeoutMilliseconds: context.request.waitMilliseconds,
      }),
      context.correlationId,
      startedAt
    );
  } catch (error: unknown) {
    return benchmarkFailure(error, started);
  }
}

export class ApexSoapFlowBenchmarkGateway implements FlowBenchmarkGateway {
  private readonly soap: ApexSoapExecuteAnonymous;

  public constructor(connection: Connection) {
    this.soap = new ApexSoapExecuteAnonymous(connection);
  }

  public async execute(request: FlowBenchmarkExecutionRequest): Promise<FlowBenchmarkTransportSample> {
    const correlationId = randomUUID();
    const apexSource = createBoundedFlowDebugApex({ correlationId, ...request });
    return executeSample(this.soap, { request, correlationId, apexSource });
  }
}
