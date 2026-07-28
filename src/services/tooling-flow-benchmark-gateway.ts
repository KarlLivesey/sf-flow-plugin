/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';

import { flowDebugCleanupFailed, flowDebugFailed, flowDebugPermissionDenied } from '../errors/flow-errors.js';
import type {
  FlowBenchmarkSession,
  FlowBenchmarkSessionGateway,
  FlowBenchmarkSessionRequest,
  FlowBenchmarkTransportSample,
} from '../types/flow-benchmark.js';
import type { FlowDebugExecutionRequest } from '../types/flow-debug.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { FlowBenchmarkExecutionError } from '../utils/flow-benchmark-error.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import {
  type CorrelatedBenchmarkLog,
  ToolingFlowBenchmarkLogCollector,
} from './tooling-flow-benchmark-log-collector.js';
import {
  apexExecutionSchema,
  identitySchema,
  isPermissionFailure,
  transportStatusSuffix,
} from './tooling-flow-debug-support.js';
import { ToolingFlowDebugTrace, type TraceState } from './tooling-flow-debug-trace.js';

const TRACE_RENEWAL_MARGIN_MILLISECONDS = 60_000;

interface BenchmarkContext {
  apiName: string;
  apexSource: string;
  correlationId: string;
  startedAt: Date;
}

interface SessionDependencies {
  collector: ToolingFlowBenchmarkLogCollector;
  connection: Connection;
  request: FlowBenchmarkSessionRequest;
  traces: ToolingFlowDebugTrace;
  trace: TraceState;
  userId: string;
}

interface SafeLogResult {
  log: CorrelatedBenchmarkLog | null;
  error: unknown;
}

function createContext(request: FlowDebugExecutionRequest): BenchmarkContext {
  const correlationId = randomUUID();
  return {
    correlationId,
    apiName: qualifiedFlowName(request.apiName, request.namespace),
    apexSource: createBoundedFlowDebugApex({ correlationId, ...request }),
    startedAt: new Date(Date.now() - 5000),
  };
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error && /^Flow[A-Z][A-Za-z]+$/u.test(error.name) ? error.name : 'FlowBenchmarkFailed';
}

function traceRequest(request: FlowBenchmarkSessionRequest): FlowDebugExecutionRequest {
  return { ...request, waitMilliseconds: request.traceDurationMilliseconds };
}

function compiledMeasurement(
  execution: ReturnType<typeof apexExecutionSchema.parse>,
  started: number,
  cancelLog: () => void
): { execution: ReturnType<typeof apexExecutionSchema.parse>; wallClockMilliseconds: number } {
  const wallClockMilliseconds = performance.now() - started;
  if (!execution.compiled) {
    cancelLog();
    throw new FlowBenchmarkExecutionError('FlowDebugFailed', wallClockMilliseconds);
  }
  return { execution, wallClockMilliseconds };
}

async function resolveLog(
  context: BenchmarkContext,
  measured: { execution: ReturnType<typeof apexExecutionSchema.parse>; wallClockMilliseconds: number },
  logResult: Promise<SafeLogResult>
): Promise<FlowBenchmarkTransportSample> {
  try {
    const resolved = await logResult;
    if (resolved.log === null) {
      throw resolved.error;
    }
    return {
      wallClockMilliseconds: measured.wallClockMilliseconds,
      transport: { correlationId: context.correlationId, execution: measured.execution, ...resolved.log },
    };
  } catch (error: unknown) {
    throw new FlowBenchmarkExecutionError(safeErrorCode(error), measured.wallClockMilliseconds);
  }
}

class ToolingFlowBenchmarkSession implements FlowBenchmarkSession {
  private closed = false;
  private trace: TraceState | null;

  public constructor(private readonly dependencies: SessionDependencies) {
    this.trace = dependencies.trace;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dependencies.collector.close();
    await this.restoreTrace();
  }

  public async execute(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkTransportSample> {
    this.assertOpen();
    const context = createContext(request);
    const registration = this.registerLog(context, request.waitMilliseconds);
    const measured = await this.measureExecution(context, registration.cancel);
    return resolveLog(context, measured, registration.result);
  }

  public async prepareBatch(): Promise<void> {
    this.assertOpen();
    const trace = this.trace;
    if (trace === null) {
      throw flowDebugFailed('The Flow benchmark tracing session is already closed.');
    }
    const remaining = Date.parse(trace.temporary.expirationDate) - Date.now();
    if (remaining > this.dependencies.request.waitMilliseconds + TRACE_RENEWAL_MARGIN_MILLISECONDS) {
      return;
    }
    this.trace = null;
    await this.dependencies.traces.close(trace);
    this.trace = await this.dependencies.traces.open(this.dependencies.userId, traceRequest(this.dependencies.request));
  }

  private assertOpen(): void {
    if (this.closed) {
      throw flowDebugFailed('The Flow benchmark tracing session is already closed.');
    }
  }

  private async executeAnonymous(context: BenchmarkContext): Promise<ReturnType<typeof apexExecutionSchema.parse>> {
    try {
      return apexExecutionSchema.parse(await this.dependencies.connection.tooling.executeAnonymous(context.apexSource));
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(context.apiName);
      }
      throw flowDebugFailed(
        `Salesforce could not execute a rollback benchmark sample for Flow "${context.apiName}".${transportStatusSuffix(
          error
        )}`
      );
    }
  }

  private async measureExecution(
    context: BenchmarkContext,
    cancelLog: () => void
  ): Promise<{ execution: ReturnType<typeof apexExecutionSchema.parse>; wallClockMilliseconds: number }> {
    const started = performance.now();
    try {
      const execution = await this.executeAnonymous(context);
      return compiledMeasurement(execution, started, cancelLog);
    } catch (error: unknown) {
      cancelLog();
      if (error instanceof FlowBenchmarkExecutionError) {
        throw error;
      }
      throw new FlowBenchmarkExecutionError(safeErrorCode(error), null);
    }
  }

  private registerLog(
    context: BenchmarkContext,
    waitMilliseconds: number
  ): { cancel: () => void; result: Promise<SafeLogResult> } {
    const registration = this.dependencies.collector.register({
      apiName: context.apiName,
      correlationId: context.correlationId,
      startedAt: context.startedAt,
      waitMilliseconds,
    });
    return {
      cancel: (): void => {
        registration.cancel();
      },
      result: registration.result.then(
        (log) => ({ log, error: null }),
        (error: unknown) => ({ log: null, error })
      ),
    };
  }

  private async restoreTrace(): Promise<void> {
    const trace = this.trace;
    this.trace = null;
    if (trace === null) {
      return;
    }
    try {
      await this.dependencies.traces.close(trace);
    } catch (error: unknown) {
      throw flowDebugCleanupFailed('Could not completely restore tracing after the Flow benchmark.', error);
    }
  }
}

export class ToolingFlowBenchmarkGateway implements FlowBenchmarkSessionGateway {
  private readonly traces: ToolingFlowDebugTrace;

  public constructor(private readonly connection: Connection) {
    this.traces = new ToolingFlowDebugTrace(connection);
  }

  public async open(request: FlowBenchmarkSessionRequest): Promise<FlowBenchmarkSession> {
    const apiName = qualifiedFlowName(request.apiName, request.namespace);
    try {
      return await this.openSession(request);
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(apiName);
      }
      if (error instanceof Error && error.name.startsWith('FlowDebug')) {
        throw error;
      }
      throw flowDebugFailed(`Could not start rollback tracing for Flow benchmark "${apiName}".`, error);
    }
  }

  private async openSession(request: FlowBenchmarkSessionRequest): Promise<FlowBenchmarkSession> {
    const identity = identitySchema.parse(await this.connection.identity());
    const trace = await this.traces.open(identity.userId, traceRequest(request));
    return new ToolingFlowBenchmarkSession({
      collector: new ToolingFlowBenchmarkLogCollector(this.connection, identity.userId),
      connection: this.connection,
      request,
      traces: this.traces,
      trace,
      userId: identity.userId,
    });
  }
}
