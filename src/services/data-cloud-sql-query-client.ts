/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

const queryMetadataSchema = z.object({ name: z.string().min(1) });
const queryStatusSchema = z.object({
  completionStatus: z.string().min(1),
  progress: z.number().min(0).max(1).optional(),
  queryId: z.string().regex(/^[\w%.~-]+$/u),
  rowCount: z.number().int().nonnegative(),
});
const queryResponseSchema = z.object({
  data: z.array(z.array(z.unknown())).optional(),
  metadata: z.array(queryMetadataSchema).optional(),
  progress: z.number().min(0).max(1).optional(),
  returnedRows: z.number().int().nonnegative().optional(),
  status: queryStatusSchema,
});

type QueryResponse = z.infer<typeof queryResponseSchema>;
type DataCloudRecord = Record<string, unknown>;

interface RowCollection {
  queryId: string;
  rowCount: number;
  offset: number;
  records: DataCloudRecord[];
}

const ROW_LIMIT = 2000;
const MAX_STATUS_REQUESTS = 6;

function parseResponse(response: unknown): QueryResponse {
  const parsed = queryResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new Error('Data Cloud returned a malformed SQL query response.');
  }
  return parsed.data;
}

function isComplete(response: QueryResponse): boolean {
  return response.status.completionStatus === 'Finished' || response.progress === 1 || response.status.progress === 1;
}

function isFailed(response: QueryResponse): boolean {
  return ['aborted', 'error', 'failed'].includes(response.status.completionStatus.toLowerCase());
}

function assertQuerySucceeded(response: QueryResponse): void {
  if (isFailed(response)) {
    throw new Error(`Data Cloud SQL query ${response.status.completionStatus.toLowerCase()}.`);
  }
}

function recordsForResponse(response: QueryResponse): DataCloudRecord[] {
  const metadata = response.metadata ?? [];
  const data = response.data ?? [];
  if (data.some((row) => row.length !== metadata.length)) {
    throw new Error('Data Cloud returned SQL rows that do not match their metadata.');
  }
  return data.map((row) => Object.fromEntries(metadata.map((field, index) => [field.name, row[index]])));
}

function inlineRecords(initial: QueryResponse, completed: QueryResponse): DataCloudRecord[] {
  const initialRecords = recordsForResponse(initial);
  const completedRecords = completed === initial ? initialRecords : recordsForResponse(completed);
  const records = initialRecords.length > 0 ? initialRecords : completedRecords;
  if (records.length > completed.status.rowCount) {
    throw new Error('Data Cloud returned more SQL rows than its reported row count.');
  }
  return records;
}

export class DataCloudSqlQueryClient {
  private readonly baseUrl: string;

  public constructor(private readonly connection: Connection) {
    this.baseUrl = `/services/data/v${connection.version}/ssot/query-sql`;
  }

  public async query(sql: string): Promise<ReadonlyArray<DataCloudRecord>> {
    const initial = await this.start(sql);
    assertQuerySucceeded(initial);
    const completed = isComplete(initial) ? initial : await this.waitForCompletion(initial);
    const records = inlineRecords(initial, completed);
    if (records.length === completed.status.rowCount) {
      return records;
    }
    return this.collectRows({
      queryId: completed.status.queryId,
      rowCount: completed.status.rowCount,
      offset: records.length,
      records,
    });
  }

  private async start(sql: string): Promise<QueryResponse> {
    const response: unknown = await this.connection.request({
      method: 'POST',
      url: this.baseUrl,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql, rowLimit: ROW_LIMIT }),
    });
    return parseResponse(response);
  }

  private async waitForCompletion(
    response: QueryResponse,
    remainingRequests = MAX_STATUS_REQUESTS
  ): Promise<QueryResponse> {
    assertQuerySucceeded(response);
    if (remainingRequests === 0) {
      throw new Error('Data Cloud SQL query did not complete within 60 seconds.');
    }
    const next = await this.getStatus(response.status.queryId);
    assertQuerySucceeded(next);
    return isComplete(next) ? next : this.waitForCompletion(next, remainingRequests - 1);
  }

  private async getStatus(queryId: string): Promise<QueryResponse> {
    const response: unknown = await this.connection.request(`${this.baseUrl}/${queryId}?waitTimeMs=10000`);
    return parseResponse(response);
  }

  private async collectRows(collection: RowCollection): Promise<DataCloudRecord[]> {
    const page = recordsForResponse(await this.getRows(collection.queryId, collection.offset));
    if (page.length === 0) {
      throw new Error('Data Cloud returned fewer SQL rows than its reported row count.');
    }
    const records = [...collection.records, ...page];
    return records.length >= collection.rowCount
      ? records.slice(0, collection.rowCount)
      : this.collectRows({ ...collection, offset: records.length, records });
  }

  private async getRows(queryId: string, offset: number): Promise<QueryResponse> {
    const response: unknown = await this.connection.request(
      `${this.baseUrl}/${queryId}/rows?offset=${offset}&rowLimit=${ROW_LIMIT}`
    );
    return parseResponse(response);
  }
}
