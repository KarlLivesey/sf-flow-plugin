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

const BENCHMARK_LOG_QUERY_LIMIT = 2000;
const CORRELATION_PATTERN = /SF_FLOW_PLUGIN_DEBUG\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|/giu;

type ApexLogRecord = z.infer<typeof apexLogQuerySchema>['records'][number];

export interface CorrelatedBenchmarkLog {
  log: FlowDebugLogRecord;
  rawLog: string;
}

interface PendingLog {
  apiName: string;
  correlationId: string;
  startedAt: Date;
  deadline: number;
  resolve: (log: CorrelatedBenchmarkLog) => void;
  reject: (error: Error) => void;
}

export interface BenchmarkLogRegistration {
  result: Promise<CorrelatedBenchmarkLog>;
  cancel(): void;
}

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

function isMissingLog(error: unknown): boolean {
  return transportCodes(error).some((code) => ['404', 'ERROR_HTTP_404', 'NOT_FOUND'].includes(code));
}

export class ToolingFlowBenchmarkLogCollector {
  private readonly inspected = new Set<string>();
  private readonly pending = new Map<string, PendingLog>();
  private polling = false;
  private closed = false;

  public constructor(private readonly connection: Connection, private readonly userId: string) {}

  public close(): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(flowDebugFailed(`Benchmark log collection ended before Flow "${pending.apiName}" completed.`));
    }
    this.pending.clear();
  }

  public register(options: {
    apiName: string;
    correlationId: string;
    startedAt: Date;
    waitMilliseconds: number;
  }): BenchmarkLogRegistration {
    if (this.closed) {
      throw flowDebugFailed('The Flow benchmark log collector is already closed.');
    }
    const result = new Promise<CorrelatedBenchmarkLog>((resolve, reject) => {
      const pending = {
        ...options,
        deadline: Date.now() + options.waitMilliseconds,
        resolve,
        reject,
      };
      this.pending.set(options.correlationId, pending);
      this.startPolling();
    });
    return {
      result,
      cancel: (): void => {
        this.pending.delete(options.correlationId);
      },
    };
  }

  private async fetchBody(record: ApexLogRecord): Promise<string | null> {
    try {
      const apiVersion = this.connection.getApiVersion();
      const rawLog = await this.connection.request<string>(
        `/services/data/v${apiVersion}/tooling/sobjects/ApexLog/${record.Id}/Body`
      );
      return typeof rawLog === 'string' ? rawLog : null;
    } catch (error: unknown) {
      if (isMissingLog(error)) {
        return null;
      }
      throw error;
    }
  }

  private async fetch(record: ApexLogRecord): Promise<void> {
    const rawLog = await this.fetchBody(record);
    if (rawLog === null) {
      return;
    }
    this.resolveCorrelations(record, rawLog);
  }

  private resolveCorrelations(record: ApexLogRecord, rawLog: string): void {
    const correlations = new Set(Array.from(rawLog.matchAll(CORRELATION_PATTERN), (matched) => matched[1]));
    for (const correlationId of correlations) {
      if (correlationId === undefined) {
        continue;
      }
      const pending = this.pending.get(correlationId);
      if (pending !== undefined) {
        this.pending.delete(correlationId);
        pending.resolve({ log: logRecord(record), rawLog });
      }
    }
  }

  private query(): string {
    const startedAt = [...this.pending.values()].reduce(
      (earliest, pending) => (pending.startedAt < earliest ? pending.startedAt : earliest),
      new Date()
    );
    return [
      'SELECT Id, Status, Operation, StartTime, DurationMilliseconds, LogLength',
      'FROM ApexLog',
      `WHERE LogUserId = '${this.userId}'`,
      `AND StartTime >= ${startedAt.toISOString()}`,
      "AND Status != 'Processing'",
      `ORDER BY StartTime DESC LIMIT ${BENCHMARK_LOG_QUERY_LIMIT}`,
    ].join(' ');
  }

  private rejectExpired(): void {
    const now = Date.now();
    for (const [correlationId, pending] of this.pending) {
      if (now > pending.deadline) {
        this.pending.delete(correlationId);
        pending.reject(flowDebugLogNotFound(pending.apiName));
      }
    }
  }

  private rejectPending(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(
        isPermissionFailure(error)
          ? flowDebugPermissionDenied(pending.apiName)
          : flowDebugFailed(
              `Could not retrieve a correlated benchmark log for Flow "${pending.apiName}".${transportStatusSuffix(
                error
              )}`
            )
      );
    }
    this.pending.clear();
  }

  private startPolling(): void {
    if (this.polling) {
      return;
    }
    this.polling = true;
    void this.poll().finally(() => {
      this.polling = false;
      if (this.pending.size > 0 && !this.closed) {
        this.startPolling();
      }
    });
  }

  private async poll(): Promise<void> {
    try {
      if (this.pending.size === 0 || this.closed) {
        return;
      }
      const records = apexLogQuerySchema.parse(await this.connection.tooling.query(this.query())).records;
      const unseen = records.filter((record) => !this.inspected.has(record.Id));
      unseen.forEach((record) => this.inspected.add(record.Id));
      await boundedMap(unseen, 5, async (record) => this.fetch(record));
      this.rejectExpired();
      await this.pollAfterDelay();
    } catch (error: unknown) {
      this.rejectPending(error);
    }
  }

  private async pollAfterDelay(): Promise<void> {
    if (this.pending.size > 0) {
      await wait(1000);
      await this.poll();
    }
  }
}
