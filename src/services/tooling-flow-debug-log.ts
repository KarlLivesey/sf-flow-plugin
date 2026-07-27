/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { setTimeout as wait } from 'node:timers/promises';

import type { Connection } from '@salesforce/core';
import type { z } from 'zod';

import { flowDebugFailed, flowDebugLogNotFound, flowDebugPermissionDenied } from '../errors/flow-errors.js';
import type { FlowDebugLogRecord } from '../types/flow-debug.js';
import { boundedMap } from '../utils/bounded-map.js';
import {
  apexLogQuerySchema,
  isPermissionFailure,
  transportCodes,
  transportStatusSuffix,
} from './tooling-flow-debug-support.js';

interface LogSearch {
  userId: string;
  apiName: string;
  correlationId: string;
  startedAt: Date;
  deadline: number;
  inspected: Set<string>;
}

interface CorrelatedLog {
  log: FlowDebugLogRecord;
  rawLog: string;
}

type ApexLogRecord = z.infer<typeof apexLogQuerySchema>['records'][number];

function logRecord(record: ApexLogRecord): FlowDebugLogRecord {
  return {
    id: record.Id,
    status: record.Status,
    operation: record.Operation,
    startTime: record.StartTime,
    durationMilliseconds: record.DurationMilliseconds,
    logLength: record.LogLength,
  };
}

function query(search: LogSearch): string {
  return [
    'SELECT Id, Status, Operation, StartTime, DurationMilliseconds, LogLength',
    'FROM ApexLog',
    `WHERE LogUserId = '${search.userId}'`,
    `AND StartTime >= ${search.startedAt.toISOString()}`,
    "AND Status != 'Processing'",
    'ORDER BY StartTime DESC LIMIT 100',
  ].join(' ');
}

function isMissingLog(error: unknown): boolean {
  return transportCodes(error).some((code) => ['404', 'ERROR_HTTP_404', 'NOT_FOUND'].includes(code));
}

export class ToolingFlowDebugLog {
  public constructor(private readonly connection: Connection) {}

  public async find(
    options: Omit<LogSearch, 'deadline' | 'inspected'> & { waitMilliseconds: number }
  ): Promise<CorrelatedLog> {
    try {
      return await this.poll({
        ...options,
        deadline: Date.now() + options.waitMilliseconds,
        inspected: new Set<string>(),
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'FlowDebugLogNotFound') {
        throw error;
      }
      if (isPermissionFailure(error)) {
        throw flowDebugPermissionDenied(options.apiName);
      }
      throw flowDebugFailed(
        `Could not retrieve the correlated debug log for Flow "${options.apiName}".${transportStatusSuffix(error)}`
      );
    }
  }

  private async fetch(record: ApexLogRecord, search: LogSearch): Promise<CorrelatedLog | null> {
    try {
      const apiVersion = this.connection.getApiVersion();
      const rawLog = await this.connection.request<string>(
        `/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${record.Id}/Body`
      );
      return typeof rawLog === 'string' && rawLog.includes(`SF_FLOW_PLUGIN_DEBUG|${search.correlationId}|`)
        ? { log: logRecord(record), rawLog }
        : null;
    } catch (error: unknown) {
      if (isMissingLog(error)) {
        return null;
      }
      throw error;
    }
  }

  private async inspect(search: LogSearch): Promise<CorrelatedLog | null> {
    const records = apexLogQuerySchema.parse(await this.connection.tooling.query(query(search))).records;
    const unseen = records.filter((record) => !search.inspected.has(record.Id));
    unseen.forEach((record) => search.inspected.add(record.Id));
    const candidates = await boundedMap(unseen, 5, async (record) => this.fetch(record, search));
    return candidates.find((candidate) => candidate !== null) ?? null;
  }

  private async poll(search: LogSearch): Promise<CorrelatedLog> {
    const found = await this.inspect(search);
    if (found !== null) {
      return found;
    }
    if (Date.now() > search.deadline) {
      throw flowDebugLogNotFound(search.apiName);
    }
    await wait(1000);
    return this.poll(search);
  }
}
