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
  FlowBenchmarkTransportSample,
} from '../types/flow-benchmark.js';
import type { FlowDebugExecutionRequest } from '../types/flow-debug.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { ToolingFlowDebugLog } from './tooling-flow-debug-log.js';
import {
  apexExecutionSchema,
  identitySchema,
  isPermissionFailure,
  transportStatusSuffix,
} from './tooling-flow-debug-support.js';
import { ToolingFlowDebugTrace, type TraceState } from './tooling-flow-debug-trace.js';

const BENCHMARK_TRACE_WAIT_MILLISECONDS = 86_280_000;
const BENCHMARK_LOG_QUERY_LIMIT = 2000;

interface BenchmarkContext {
  apiName: string;
  apexSource: string;
  correlationId: string;
  startedAt: Date;
}

interface SessionDependencies {
  connection: Connection;
  logs: ToolingFlowDebugLog;
  traces: ToolingFlowDebugTrace;
  trace: TraceState;
  userId: string;
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

class ToolingFlowBenchmarkSession implements FlowBenchmarkSession {
  private closed = false;

  public constructor(private readonly dependencies: SessionDependencies) {}

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.dependencies.traces.close(this.dependencies.trace);
    } catch (error: unknown) {
      throw flowDebugCleanupFailed('Could not completely restore tracing after the Flow benchmark.', error);
    }
  }

  public async execute(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkTransportSample> {
    if (this.closed) {
      throw flowDebugFailed('The Flow benchmark tracing session is already closed.');
    }
    const context = createContext(request);
    const started = performance.now();
    const execution = await this.executeAnonymous(context);
    const wallClockMilliseconds = performance.now() - started;
    if (!execution.compiled) {
      throw flowDebugFailed(
        `Salesforce could not compile the generated Flow benchmark transaction at line ${execution.line}, column ${execution.column}.`
      );
    }
    const log = await this.dependencies.logs.find({
      userId: this.dependencies.userId,
      apiName: context.apiName,
      correlationId: context.correlationId,
      startedAt: context.startedAt,
      waitMilliseconds: request.waitMilliseconds,
      queryLimit: BENCHMARK_LOG_QUERY_LIMIT,
    });
    return {
      wallClockMilliseconds,
      transport: { correlationId: context.correlationId, execution, ...log },
    };
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
}

export class ToolingFlowBenchmarkGateway implements FlowBenchmarkSessionGateway {
  private readonly logs: ToolingFlowDebugLog;
  private readonly traces: ToolingFlowDebugTrace;

  public constructor(private readonly connection: Connection) {
    this.logs = new ToolingFlowDebugLog(connection);
    this.traces = new ToolingFlowDebugTrace(connection);
  }

  public async open(request: FlowDebugExecutionRequest): Promise<FlowBenchmarkSession> {
    const apiName = qualifiedFlowName(request.apiName, request.namespace);
    try {
      const identity = identitySchema.parse(await this.connection.identity());
      const trace = await this.traces.open(identity.userId, {
        ...request,
        waitMilliseconds: BENCHMARK_TRACE_WAIT_MILLISECONDS,
      });
      return new ToolingFlowBenchmarkSession({
        connection: this.connection,
        logs: this.logs,
        traces: this.traces,
        trace,
        userId: identity.userId,
      });
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
}
