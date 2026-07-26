/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

import { flowDataCloudMetricsFailed, flowDataCloudMetricsUnavailable } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema, positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowRuntimeMetrics,
  FlowRuntimeMetricsGateway,
  FlowRuntimeMetricsRequest,
} from '../types/flow-metrics.js';
import { parseFlowRuntimeBreakdown, summariseFlowRuntimeMetrics } from '../utils/flow-runtime-metrics.js';
import { qualifiedFlowName } from '../utils/flow-state.js';

interface FlowDmoSchema {
  flowObject: string;
  flowId: string;
  flowName: string;
  versionObject: string;
  versionId: string;
  versionFlowId: string;
  versionNumber: string;
  runObject: string;
  runId: string;
  runVersionId: string;
  runStatus: string;
  runDuration?: string;
  runScheduled: string;
  runCompleted: string;
  runErrorReason: string;
}

interface ResolvedDataCloudVersion {
  schema: FlowDmoSchema;
  versionId: string;
}

interface IdentifierDetails {
  field: string;
  label: string;
  name: string;
}

interface SchemaResolution {
  name: string;
  schemaIndex: number;
  previousError?: unknown;
}

type DataCloudRecord = Record<string, unknown>;

const queryResultSchema = z.object({
  records: z.array(z.record(z.string(), z.unknown())),
});
const runtimeMetricsRequestSchema: z.ZodType<FlowRuntimeMetricsRequest> = z.object({
  apiName: flowApiNameSchema,
  namespace: namespaceSchema.nullable(),
  version: positiveFlowVersionSchema,
  windowDays: positiveFlowVersionSchema,
});

function validateRuntimeMetricsRequest(request: FlowRuntimeMetricsRequest): FlowRuntimeMetricsRequest {
  const validated = runtimeMetricsRequestSchema.safeParse(request);
  if (!validated.success) {
    throw flowDataCloudMetricsFailed('The Data Cloud Flow metrics request is invalid.', validated.error);
  }
  return validated.data;
}

const DMO_SCHEMAS: ReadonlyArray<FlowDmoSchema> = [
  {
    flowObject: 'std__FlowDmo__dlm',
    flowId: 'std__Id__c',
    flowName: 'std__NameInterfaceField__c',
    versionObject: 'std__FlowVersionDmo__dlm',
    versionId: 'std__Id__c',
    versionFlowId: 'std__FlowId__c',
    versionNumber: 'std__VersionNumber__c',
    runObject: 'std__FlowRunDmo__dlm',
    runId: 'std__Id__c',
    runVersionId: 'std__FlowVersionId__c',
    runStatus: 'std__FlowRunStatus__c',
    runDuration: 'std__FlowExecDrtnInMilliseconds__c',
    runScheduled: 'std__ScheduledDateTime__c',
    runCompleted: 'std__CompletedDateTime__c',
    runErrorReason: 'std__ErrorReason__c',
  },
  {
    flowObject: 'ssot__Flow__dlm',
    flowId: 'ssot__Id__c',
    flowName: 'ssot__Name__c',
    versionObject: 'ssot__FlowVersion__dlm',
    versionId: 'ssot__Id__c',
    versionFlowId: 'ssot__FlowId__c',
    versionNumber: 'ssot__VersionNumber__c',
    runObject: 'ssot__FlowRun__dlm',
    runId: 'ssot__Id__c',
    runVersionId: 'ssot__FlowVersionId__c',
    runStatus: 'ssot__FlowRunStatus__c',
    runScheduled: 'ssot__ScheduledDateTime__c',
    runCompleted: 'ssot__CompletedDateTime__c',
    runErrorReason: 'ssot__ErrorReason__c',
  },
];

function escapeSoqlLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function readText(record: DataCloudRecord, field: string, label: string): string {
  const parsed = z.string().min(1).safeParse(record[field]);
  if (!parsed.success) {
    throw flowDataCloudMetricsFailed(`Data Cloud returned a malformed ${label}.`);
  }
  return parsed.data;
}

function singleIdentifier(records: ReadonlyArray<DataCloudRecord>, details: IdentifierDetails): string | null {
  if (records.length === 0) {
    return null;
  }
  if (records.length > 1) {
    throw flowDataCloudMetricsFailed(`Data Cloud returned multiple ${details.label} records for "${details.name}".`);
  }
  const selected = records[0];
  return selected === undefined ? null : readText(selected, details.field, `${details.label} identifier`);
}

function buildFlowQuery(schema: FlowDmoSchema, name: string): string {
  return (
    `SELECT ${schema.flowId}, ${schema.flowName} FROM ${schema.flowObject} ` +
    `WHERE ${schema.flowName} = '${escapeSoqlLiteral(name)}' LIMIT 2`
  );
}

function buildVersionQuery(schema: FlowDmoSchema, flowId: string, version: number): string {
  return (
    `SELECT ${schema.versionId}, ${schema.versionNumber} FROM ${schema.versionObject} ` +
    `WHERE ${schema.versionFlowId} = '${escapeSoqlLiteral(flowId)}' AND ${schema.versionNumber} = ${version} LIMIT 2`
  );
}

function durationFields(schema: FlowDmoSchema): string {
  return schema.runDuration === undefined
    ? ''
    : `, AVG(${schema.runDuration}) averageDurationMilliseconds` +
        `, MIN(${schema.runDuration}) minimumDurationMilliseconds` +
        `, MAX(${schema.runDuration}) maximumDurationMilliseconds`;
}

function buildMetricsQuery(schema: FlowDmoSchema, versionId: string, from: string): string {
  return (
    `SELECT ${schema.runStatus}, ${schema.runErrorReason}` +
    `, COUNT(${schema.runId}) executions${durationFields(schema)}` +
    `, MIN(${schema.runScheduled}) firstExecution, MAX(${schema.runCompleted}) lastExecution ` +
    `FROM ${schema.runObject} WHERE ${schema.runVersionId} = '${escapeSoqlLiteral(versionId)}' ` +
    `AND ${schema.runScheduled} >= ${from} GROUP BY ${schema.runStatus}, ${schema.runErrorReason}`
  );
}

function normaliseBreakdown(record: DataCloudRecord, schema: FlowDmoSchema): DataCloudRecord {
  return {
    ...record,
    runStatus: record[schema.runStatus],
    errorReason: record[schema.runErrorReason],
  };
}

export class DataCloudFlowMetricsGateway implements FlowRuntimeMetricsGateway {
  public constructor(private readonly connection: Connection) {}

  public async getMetrics(request: FlowRuntimeMetricsRequest): Promise<FlowRuntimeMetrics> {
    const validatedRequest = validateRuntimeMetricsRequest(request);
    const from = new Date(Date.now() - validatedRequest.windowDays * 86_400_000).toISOString();
    const resolved = await this.resolveVersion(validatedRequest);
    try {
      const records = await this.query(buildMetricsQuery(resolved.schema, resolved.versionId, from));
      const breakdowns = records.map((record) =>
        parseFlowRuntimeBreakdown(normaliseBreakdown(record, resolved.schema))
      );
      return summariseFlowRuntimeMetrics(validatedRequest, from, breakdowns);
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('FlowDataCloud')) {
        throw error;
      }
      throw flowDataCloudMetricsFailed(
        `Could not query Data Cloud runtime metrics for Flow "${validatedRequest.apiName}".`,
        error
      );
    }
  }

  private async resolveVersion(request: FlowRuntimeMetricsRequest): Promise<ResolvedDataCloudVersion> {
    const name = qualifiedFlowName(request.apiName, request.namespace);
    return this.resolveWithSchema(request, { name, schemaIndex: 0 });
  }

  private async resolveWithSchema(
    request: FlowRuntimeMetricsRequest,
    resolution: SchemaResolution
  ): Promise<ResolvedDataCloudVersion> {
    const schema = DMO_SCHEMAS[resolution.schemaIndex];
    if (schema === undefined) {
      throw flowDataCloudMetricsUnavailable(
        `Data Cloud Flow metrics are not available for "${resolution.name}" version ${request.version}.`,
        resolution.previousError
      );
    }
    let resolved: ResolvedDataCloudVersion | null;
    try {
      resolved = await this.findVersion(schema, resolution.name, request.version);
    } catch (error: unknown) {
      return this.resolveWithSchema(request, {
        name: resolution.name,
        schemaIndex: resolution.schemaIndex + 1,
        previousError: error,
      });
    }
    return (
      resolved ??
      this.resolveWithSchema(request, {
        ...resolution,
        schemaIndex: resolution.schemaIndex + 1,
      })
    );
  }

  private async findVersion(
    schema: FlowDmoSchema,
    name: string,
    version: number
  ): Promise<ResolvedDataCloudVersion | null> {
    const flows = await this.query(buildFlowQuery(schema, name));
    const flowId = singleIdentifier(flows, { field: schema.flowId, label: 'Flow', name });
    if (flowId === null) {
      return null;
    }
    const versions = await this.query(buildVersionQuery(schema, flowId, version));
    const versionId = singleIdentifier(versions, {
      field: schema.versionId,
      label: 'Flow version',
      name: `${name} v${version}`,
    });
    return versionId === null ? null : { schema, versionId };
  }

  private async query(soql: string): Promise<ReadonlyArray<DataCloudRecord>> {
    const response: unknown = await this.connection.query(soql);
    const parsed = queryResultSchema.safeParse(response);
    if (!parsed.success) {
      throw flowDataCloudMetricsFailed('Data Cloud returned a malformed query response.');
    }
    return parsed.data.records;
  }
}
