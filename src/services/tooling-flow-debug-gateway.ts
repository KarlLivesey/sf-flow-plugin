/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';

import {
  flowDebugCleanupFailed,
  flowDebugFailed,
  flowDebugPermissionDenied,
  flowQueryFailed,
} from '../errors/flow-errors.js';
import type {
  FlowDebugApexResult,
  FlowDebugExecutionRequest,
  FlowDebugTransportProgress,
  FlowDebugTransportResult,
} from '../types/flow-debug.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { ToolingFlowDebugLog } from './tooling-flow-debug-log.js';
import {
  apexExecutionSchema,
  debugLogPermissionSchema,
  debugObjectPermissionSchema,
  identitySchema,
  isPermissionFailure,
  organisationResultSchema,
  transportStatusSuffix,
} from './tooling-flow-debug-support.js';
import { ToolingFlowDebugTrace, type TraceState } from './tooling-flow-debug-trace.js';

interface ExecutionContext {
  request: FlowDebugExecutionRequest;
  apiName: string;
  apexSource: string;
  correlationId: string;
  userId: string;
  startedAt: Date;
}

interface CapturedErrors {
  apiName: string;
  operation: CapturedOperation;
  cleanupError: Error | undefined;
  trace: TraceState;
}

type CapturedOperation = { success: true; result: FlowDebugTransportResult } | { success: false; error: Error };

function hasDebugPermissions(debugLevel: unknown, traceFlag: unknown, apexLog: unknown): boolean {
  const debugLevelAccess = debugObjectPermissionSchema.parse(debugLevel);
  const traceFlagAccess = debugObjectPermissionSchema.parse(traceFlag);
  const apexLogAccess = debugLogPermissionSchema.parse(apexLog);
  return (
    debugLevelAccess.createable &&
    debugLevelAccess.deletable &&
    traceFlagAccess.createable &&
    traceFlagAccess.updateable &&
    traceFlagAccess.deletable &&
    apexLogAccess.queryable &&
    apexLogAccess.retrieveable
  );
}

function normaliseError(error: unknown, message: string): Error {
  return error instanceof Error ? error : flowDebugFailed(message);
}

function reportProgress(
  progress: FlowDebugTransportProgress,
  stage: Parameters<FlowDebugTransportProgress>[0],
  detail: string
): void {
  try {
    progress(stage, detail);
  } catch {
    throw flowDebugFailed('Could not report Flow debug progress.');
  }
}

function cleanupFailureDetail(error: Error): string {
  return error.name === 'FlowDebugCleanupFailed' ? ` ${error.message}` : transportStatusSuffix(error);
}

function completedLogContext(operation: CapturedOperation): string {
  return operation.success ? ` ApexLog ID: ${operation.result.log.id}.` : '';
}

function resolveCapturedOperation(context: CapturedErrors): FlowDebugTransportResult {
  if (context.cleanupError !== undefined) {
    throw flowDebugCleanupFailed(
      `Could not completely restore tracing after running Flow "${context.apiName}" with rollback. ` +
        `Temporary DebugLevel ID: ${context.trace.debugLevelId}; TraceFlag ID: ${context.trace.traceFlagId}.` +
        completedLogContext(context.operation) +
        cleanupFailureDetail(context.cleanupError)
    );
  }
  if (!context.operation.success) {
    throw context.operation.error;
  }
  return context.operation.result;
}

export class ToolingFlowDebugGateway {
  private readonly logs: ToolingFlowDebugLog;
  private readonly traces: ToolingFlowDebugTrace;

  public constructor(private readonly connection: Connection) {
    this.logs = new ToolingFlowDebugLog(connection);
    this.traces = new ToolingFlowDebugTrace(connection);
  }

  public async isProductionOrg(): Promise<boolean> {
    try {
      const result = organisationResultSchema.parse(
        await this.connection.query('SELECT IsSandbox FROM Organization LIMIT 1')
      );
      return result.records[0]?.IsSandbox === false;
    } catch (error: unknown) {
      throw flowQueryFailed(
        `Could not determine whether the target org is a production org.${transportStatusSuffix(error)}`
      );
    }
  }

  public async assertDebugAvailable(apiName: string): Promise<void> {
    try {
      const descriptions = await Promise.all([
        this.connection.tooling.describe('DebugLevel'),
        this.connection.tooling.describe('TraceFlag'),
        this.connection.tooling.describe('ApexLog'),
      ]);
      if (!hasDebugPermissions(descriptions[0], descriptions[1], descriptions[2])) {
        throw flowDebugPermissionDenied(apiName);
      }
    } catch (error: unknown) {
      if (isPermissionFailure(error) || (error instanceof Error && error.name === 'FlowDebugPermissionDenied')) {
        throw flowDebugPermissionDenied(apiName);
      }
      throw flowDebugFailed(
        `Could not verify rollback tracing permissions for Flow "${apiName}".${transportStatusSuffix(error)}`
      );
    }
  }

  public async execute(
    request: FlowDebugExecutionRequest,
    progress: FlowDebugTransportProgress = (): void => undefined
  ): Promise<FlowDebugTransportResult> {
    const context = await this.createContext(request);
    reportProgress(progress, 'configuring-trace', `${context.apiName} (${request.logLevel})`);
    const trace = await this.traces.open(context.userId, request);
    let operation = await this.captureOperation(context, progress);
    try {
      reportProgress(progress, 'restoring-trace', context.apiName);
    } catch (error: unknown) {
      if (operation.success) {
        operation = {
          success: false,
          error: normaliseError(error, 'Could not report Flow debug progress.'),
        };
      }
    }
    const cleanupError = await this.captureCleanup(trace);
    return resolveCapturedOperation({ apiName: context.apiName, operation, cleanupError, trace });
  }

  private async captureCleanup(trace: TraceState): Promise<Error | undefined> {
    try {
      await this.traces.close(trace);
      return undefined;
    } catch (error: unknown) {
      return normaliseError(error, 'An unknown error occurred while restoring Flow debug tracing.');
    }
  }

  private async captureOperation(
    context: ExecutionContext,
    progress: FlowDebugTransportProgress
  ): Promise<CapturedOperation> {
    try {
      return { success: true, result: await this.executeAndFindLog(context, progress) };
    } catch (error: unknown) {
      return {
        success: false,
        error: normaliseError(error, `An unknown error occurred while debugging Flow "${context.request.apiName}".`),
      };
    }
  }

  private async createContext(request: FlowDebugExecutionRequest): Promise<ExecutionContext> {
    const correlationId = randomUUID();
    const apexSource = createBoundedFlowDebugApex({ correlationId, ...request });
    const apiName = qualifiedFlowName(request.apiName, request.namespace);
    try {
      const identity = identitySchema.parse(await this.connection.identity());
      return {
        request,
        apiName,
        apexSource,
        correlationId,
        userId: identity.userId,
        startedAt: new Date(Date.now() - 5000),
      };
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(apiName);
      }
      throw flowDebugFailed(`Could not identify the authenticated Salesforce user.${transportStatusSuffix(error)}`);
    }
  }

  private async executeAndFindLog(
    context: ExecutionContext,
    progress: FlowDebugTransportProgress
  ): Promise<FlowDebugTransportResult> {
    reportProgress(progress, 'executing-apex', `${context.apiName} (rollback)`);
    const execution = await this.executeAnonymous(context);
    if (!execution.compiled) {
      throw flowDebugFailed(
        `Salesforce could not compile the generated Flow debug transaction at line ${execution.line}, column ${execution.column}.`
      );
    }
    reportProgress(progress, 'retrieving-log', `${context.apiName} (${context.correlationId})`);
    const log = await this.logs.find({
      userId: context.userId,
      apiName: context.apiName,
      correlationId: context.correlationId,
      startedAt: context.startedAt,
      waitMilliseconds: context.request.waitMilliseconds,
    });
    return { correlationId: context.correlationId, execution, ...log };
  }

  private async executeAnonymous(context: ExecutionContext): Promise<FlowDebugApexResult> {
    try {
      return apexExecutionSchema.parse(await this.connection.tooling.executeAnonymous(context.apexSource));
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(context.apiName);
      }
      throw flowDebugFailed(
        `Salesforce could not execute the rollback transaction for Flow "${context.apiName}".${transportStatusSuffix(
          error
        )}`
      );
    }
  }
}
