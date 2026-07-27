/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { randomUUID } from 'node:crypto';

import type { Connection } from '@salesforce/core';
import type { z } from 'zod';

import { flowDebugCleanupFailed, flowDebugFailed, flowDebugPermissionDenied } from '../errors/flow-errors.js';
import type { FlowDebugExecutionRequest } from '../types/flow-debug.js';
import { parseSalesforceDateTime } from '../utils/flow-date.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import {
  deleteResultSchema,
  isPermissionCode,
  isPermissionFailure,
  LOG_LEVELS,
  saveResultSchema,
  traceFlagQuerySchema,
  transportStatusSuffix,
} from './tooling-flow-debug-support.js';

export interface TraceState {
  debugLevelId: string;
  traceFlagId: string;
  restore: TraceFlagSnapshot | null;
  temporary: TraceFlagSnapshot;
}

interface TraceFlagSnapshot {
  debugLevelId: string;
  startDate: string;
  expirationDate: string;
}

interface TraceDates {
  startDate: string;
  expirationDate: string;
}

interface TraceChange {
  debugLevelId: string;
  traceDates: TraceDates;
  apiName: string;
}

type TraceFlagRecord = z.infer<typeof traceFlagQuerySchema>['records'][number];
type SaveResult = z.infer<typeof saveResultSchema>;

function dates(waitMilliseconds: number): TraceDates {
  return {
    startDate: new Date(Date.now() - 60_000).toISOString(),
    expirationDate: new Date(Date.now() + waitMilliseconds + 120_000).toISOString(),
  };
}

function saveFailure(apiName: string, operation: string, result: SaveResult): never {
  const code = result.success ? undefined : result.errors[0]?.errorCode;
  if (isPermissionCode(code)) {
    throw flowDebugPermissionDenied(apiName);
  }
  throw flowDebugFailed(`Salesforce could not ${operation}.${code === undefined ? '' : ` Status: ${code}.`}`);
}

function snapshot(record: TraceFlagRecord): TraceFlagSnapshot {
  return {
    debugLevelId: record.DebugLevelId,
    startDate: record.StartDate,
    expirationDate: record.ExpirationDate,
  };
}

function temporarySnapshot(change: TraceChange): TraceFlagSnapshot {
  return {
    debugLevelId: change.debugLevelId,
    startDate: change.traceDates.startDate,
    expirationDate: change.traceDates.expirationDate,
  };
}

function traceMatches(record: TraceFlagRecord, expected: TraceFlagSnapshot): boolean {
  return (
    record.DebugLevelId === expected.debugLevelId &&
    parseSalesforceDateTime(record.StartDate) === parseSalesforceDateTime(expected.startDate) &&
    parseSalesforceDateTime(record.ExpirationDate) === parseSalesforceDateTime(expected.expirationDate)
  );
}

export class ToolingFlowDebugTrace {
  public constructor(private readonly connection: Connection) {}

  public async open(userId: string, request: FlowDebugExecutionRequest): Promise<TraceState> {
    let debugLevelId: string | undefined;
    const apiName = qualifiedFlowName(request.apiName, request.namespace);
    try {
      debugLevelId = await this.createDebugLevel(request);
      return await this.upsertTraceFlag(userId, debugLevelId, request);
    } catch (error: unknown) {
      return this.handleOpenFailure(error, debugLevelId, apiName);
    }
  }

  public async close(trace: TraceState): Promise<void> {
    await this.restoreOrDeleteTraceFlag(trace);
    const deleted = deleteResultSchema.parse(await this.connection.tooling.destroy('DebugLevel', trace.debugLevelId));
    if (!deleted.success) {
      throw flowDebugCleanupFailed(`Could not delete temporary DebugLevel "${trace.debugLevelId}".`);
    }
  }

  private async handleOpenFailure(error: unknown, debugLevelId: string | undefined, apiName: string): Promise<never> {
    try {
      await this.removeOrphanedDebugLevel(debugLevelId);
    } catch (cleanupError: unknown) {
      throw flowDebugCleanupFailed(
        `Tracing setup failed and temporary DebugLevel "${debugLevelId}" could not be removed.${transportStatusSuffix(
          cleanupError
        )}`
      );
    }
    if (isPermissionFailure(error)) {
      throw flowDebugPermissionDenied(apiName);
    }
    if (error instanceof Error && ['FlowDebugFailed', 'FlowDebugPermissionDenied'].includes(error.name)) {
      throw error;
    }
    throw flowDebugFailed(
      `Could not configure temporary tracing for Flow "${apiName}".${transportStatusSuffix(error)}`
    );
  }

  private async createDebugLevel(request: FlowDebugExecutionRequest): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const result = saveResultSchema.parse(
      await this.connection.tooling.create('DebugLevel', {
        DeveloperName: `SfFlowPlugin_${suffix}`,
        MasterLabel: `sf-flow-plugin ${suffix}`,
        ...LOG_LEVELS[request.logLevel],
      })
    );
    return result.success
      ? result.id
      : saveFailure(
          qualifiedFlowName(request.apiName, request.namespace),
          `create a temporary DebugLevel for "${qualifiedFlowName(request.apiName, request.namespace)}"`,
          result
        );
  }

  private async createTraceFlag(userId: string, change: TraceChange): Promise<TraceState> {
    const result = saveResultSchema.parse(
      await this.connection.tooling.create('TraceFlag', {
        TracedEntityId: userId,
        DebugLevelId: change.debugLevelId,
        LogType: 'USER_DEBUG',
        StartDate: change.traceDates.startDate,
        ExpirationDate: change.traceDates.expirationDate,
      })
    );
    return result.success
      ? {
          debugLevelId: change.debugLevelId,
          traceFlagId: result.id,
          restore: null,
          temporary: temporarySnapshot(change),
        }
      : saveFailure(change.apiName, `create a temporary TraceFlag for "${change.apiName}"`, result);
  }

  private async findActiveTraceFlag(userId: string): Promise<TraceFlagRecord | undefined> {
    const now = new Date().toISOString();
    const query = [
      'SELECT Id, DebugLevelId, StartDate, ExpirationDate',
      'FROM TraceFlag',
      `WHERE TracedEntityId = '${userId}'`,
      "AND LogType = 'USER_DEBUG'",
      `AND StartDate <= ${now}`,
      `AND ExpirationDate >= ${now}`,
      'ORDER BY ExpirationDate DESC LIMIT 1',
    ].join(' ');
    return traceFlagQuerySchema.parse(await this.connection.tooling.query(query)).records[0];
  }

  private async findTraceFlag(traceFlagId: string): Promise<TraceFlagRecord | undefined> {
    const query = [
      'SELECT Id, DebugLevelId, StartDate, ExpirationDate',
      'FROM TraceFlag',
      `WHERE Id = '${traceFlagId}'`,
      'LIMIT 1',
    ].join(' ');
    return traceFlagQuerySchema.parse(await this.connection.tooling.query(query)).records[0];
  }

  private async removeOrphanedDebugLevel(debugLevelId: string | undefined): Promise<void> {
    if (debugLevelId !== undefined) {
      const result = deleteResultSchema.parse(await this.connection.tooling.destroy('DebugLevel', debugLevelId));
      if (!result.success) {
        throw flowDebugCleanupFailed(`Could not delete temporary DebugLevel "${debugLevelId}".`);
      }
    }
  }

  private async restoreOrDeleteTraceFlag(trace: TraceState): Promise<void> {
    const current = await this.findTraceFlag(trace.traceFlagId);
    if (current === undefined && trace.restore === null) {
      return;
    }
    if (current === undefined || !traceMatches(current, trace.temporary)) {
      throw flowDebugCleanupFailed(
        `TraceFlag "${trace.traceFlagId}" changed after temporary tracing was configured; its current settings were not overwritten.`
      );
    }
    const result =
      trace.restore === null
        ? deleteResultSchema.parse(await this.connection.tooling.destroy('TraceFlag', trace.traceFlagId))
        : saveResultSchema.parse(
            await this.connection.tooling.update('TraceFlag', {
              Id: trace.traceFlagId,
              DebugLevelId: trace.restore.debugLevelId,
              StartDate: trace.restore.startDate,
              ExpirationDate: trace.restore.expirationDate,
            })
          );
    if (!result.success) {
      throw flowDebugCleanupFailed(`Could not restore or delete TraceFlag "${trace.traceFlagId}".`);
    }
  }

  private async updateTraceFlag(existing: TraceFlagRecord, change: TraceChange): Promise<TraceState> {
    const result = saveResultSchema.parse(
      await this.connection.tooling.update('TraceFlag', {
        Id: existing.Id,
        DebugLevelId: change.debugLevelId,
        StartDate: change.traceDates.startDate,
        ExpirationDate: change.traceDates.expirationDate,
      })
    );
    return result.success
      ? {
          debugLevelId: change.debugLevelId,
          traceFlagId: existing.Id,
          restore: snapshot(existing),
          temporary: temporarySnapshot(change),
        }
      : saveFailure(change.apiName, `temporarily update TraceFlag "${existing.Id}"`, result);
  }

  private async upsertTraceFlag(
    userId: string,
    debugLevelId: string,
    request: FlowDebugExecutionRequest
  ): Promise<TraceState> {
    const existing = await this.findActiveTraceFlag(userId);
    const change = {
      debugLevelId,
      traceDates: dates(request.waitMilliseconds),
      apiName: qualifiedFlowName(request.apiName, request.namespace),
    };
    return existing === undefined ? this.createTraceFlag(userId, change) : this.updateTraceFlag(existing, change);
  }
}
