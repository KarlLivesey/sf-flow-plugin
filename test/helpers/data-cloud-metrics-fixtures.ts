/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

interface QueryResponse {
  data: unknown[][];
  metadata: Array<{ name: string }>;
  returnedRows: number;
  status: {
    completionStatus: string;
    queryId: string;
    rowCount: number;
  };
}

interface RequestDetails {
  method: string;
  url: string;
  body?: string;
}

const requestBodySchema = z.object({ sql: z.string() });

export class DataCloudConnectionDouble {
  public readonly requests: Array<string | RequestDetails> = [];
  public readonly sqlQueries: string[] = [];
  public readonly version = '65.0';
  private readonly organizationId = '00D000000000001';

  public constructor(private readonly responses: unknown[]) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  public getAuthInfoFields(): { orgId: string } {
    return { orgId: this.organizationId };
  }

  public async request(request: string | RequestDetails): Promise<unknown> {
    this.requests.push(request);
    if (typeof request !== 'string' && request.body !== undefined) {
      const body = requestBodySchema.parse(JSON.parse(request.body) as unknown);
      this.sqlQueries.push(body.sql);
    }
    const response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw new Error('Unexpected query.');
    }
    return response;
  }
}

export function page(records: Array<Record<string, unknown>>): QueryResponse {
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))];
  return {
    data: records.map((record) => names.map((name) => record[name])),
    metadata: names.map((name) => ({ name })),
    returnedRows: records.length,
    status: {
      completionStatus: 'Finished',
      queryId: 'query-1',
      rowCount: records.length,
    },
  };
}

export function dmoNotFound(): Error & { data: Record<string, never>; errorCode: string } {
  return Object.assign(new Error('Not found'), {
    data: {},
    errorCode: 'ERROR_HTTP_404',
    name: 'ERROR_HTTP_404',
  });
}

export function standardFlowRecord(): Record<string, unknown> {
  return { ['std__Id__c']: 'flow-1', ['std__NameInterfaceField__c']: 'Order_Flow' };
}

export function standardVersionRecord(): Record<string, unknown> {
  return { ['std__Id__c']: 'version-7', ['std__VersionNumber__c']: 7 };
}

export function standardRunRecords(): Array<Record<string, unknown>> {
  return [
    {
      ['std__FlowRunStatus__c']: 'Complete',
      ['std__ErrorReason__c']: null,
      executions: 2,
      averageDurationMilliseconds: 12,
      minimumDurationMilliseconds: 10,
      maximumDurationMilliseconds: 14,
      firstExecution: '2026-07-20T10:00:00.000Z',
      lastExecution: '2026-07-21T10:00:00.000Z',
    },
    {
      ['std__FlowRunStatus__c']: 'Paused-Error',
      ['std__ErrorReason__c']: 'InternalError',
      executions: 1,
      averageDurationMilliseconds: 20,
      minimumDurationMilliseconds: 20,
      maximumDurationMilliseconds: 20,
      firstExecution: '2026-07-22T10:00:00.000Z',
      lastExecution: '2026-07-22T10:00:01.000Z',
    },
  ];
}

export function legacyFlowRecord(): Record<string, unknown> {
  return { ['ssot__Id__c']: 'flow-1', ['ssot__Name__c']: 'Order_Flow' };
}

export function legacyVersionRecord(): Record<string, unknown> {
  return { ['ssot__Id__c']: 'version-7', ['ssot__VersionNumber__c']: 7 };
}
