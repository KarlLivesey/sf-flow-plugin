/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';

import type { FlowBenchmarkGateway, FlowBenchmarkTransportSample } from '../types/flow-benchmark.js';
import type { FlowDebugExecutionRequest } from '../types/flow-debug.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { FlowBenchmarkExecutionError } from '../utils/flow-benchmark-error.js';
import { ApexSoapExecuteAnonymous, type ApexSoapExecuteResult } from './apex-soap-execute-anonymous.js';
import { isPermissionFailure } from './flow-debug-transport-support.js';

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
  throw new FlowBenchmarkExecutionError({
    errorCode: safeErrorCode(error),
    executionDurationMilliseconds: performance.now() - started,
  });
}

async function executeSample(
  soap: ApexSoapExecuteAnonymous,
  context: { request: FlowDebugExecutionRequest; correlationId: string; apexSource: string }
): Promise<FlowBenchmarkTransportSample> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  try {
    return transportSample(
      await soap.execute({ apexSource: context.apexSource, logLevel: context.request.logLevel }),
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

  public async execute(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkTransportSample> {
    const correlationId = randomUUID();
    const apexSource = createBoundedFlowDebugApex({ correlationId, ...request });
    return executeSample(this.soap, { request, correlationId, apexSource });
  }
}
