/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

import { FLOW_DMO_SCHEMAS, type FlowDmoSchema } from '../constants/data-cloud-flow-dmo-schemas.js';
import { flowDataCloudMetricsFailed, flowDataCloudMetricsUnavailable } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema, positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowRuntimeMetricBreakdown,
  FlowRuntimeMetrics,
  FlowRuntimeMetricsGateway,
  FlowRuntimeMetricsRequest,
} from '../types/flow-metrics.js';
import { parseFlowRuntimeBreakdown, summariseFlowRuntimeMetrics } from '../utils/flow-runtime-metrics.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { DataCloudSqlQueryClient } from './data-cloud-sql-query-client.js';

interface ResolvedDataCloudVersion {
  schema: FlowDmoSchema;
  versionId: string;
}

interface IdentifierDetails {
  field: string;
  label: string;
  name: string;
}

interface VersionLookup {
  name: string;
  organizationId: string;
  version: number;
}

interface MetricsQuery {
  from: string;
  organizationId: string;
  versionId: string;
}

type DataCloudRecord = Record<string, unknown>;

const httpErrorSchema = z
  .object({
    errorCode: z.unknown().optional(),
    name: z.unknown().optional(),
    status: z.unknown().optional(),
    statusCode: z.unknown().optional(),
  })
  .passthrough();
const httpCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/u);
const httpStatusSchema = z.number().int();

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

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
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

function buildFlowQuery(schema: FlowDmoSchema, name: string, organizationId: string): string {
  return (
    `SELECT ${schema.flowId}, ${schema.flowName} FROM ${schema.flowObject} ` +
    `WHERE ${schema.flowName} = '${escapeSqlLiteral(name)}' ` +
    `AND ${schema.flowOrganizationId} = '${escapeSqlLiteral(organizationId)}' LIMIT 2`
  );
}

function buildVersionQuery(schema: FlowDmoSchema, flowId: string, lookup: VersionLookup): string {
  return (
    `SELECT ${schema.versionId}, ${schema.versionNumber} FROM ${schema.versionObject} ` +
    `WHERE ${schema.versionFlowId} = '${escapeSqlLiteral(flowId)}' ` +
    `AND ${schema.versionNumber} = ${lookup.version} ` +
    `AND ${schema.versionOrganizationId} = '${escapeSqlLiteral(lookup.organizationId)}' LIMIT 2`
  );
}

function durationFields(schema: FlowDmoSchema): string {
  return schema.runDuration === undefined
    ? ''
    : `, AVG(${schema.runDuration}) AS "averageDurationMilliseconds"` +
        `, MIN(${schema.runDuration}) AS "minimumDurationMilliseconds"` +
        `, MAX(${schema.runDuration}) AS "maximumDurationMilliseconds"`;
}

function buildMetricsQuery(schema: FlowDmoSchema, query: MetricsQuery): string {
  return (
    `SELECT ${schema.runStatus}, ${schema.runErrorReason}` +
    `, COUNT(${schema.runId}) AS "executions"${durationFields(schema)}` +
    `, MIN(${schema.runScheduled}) AS "firstExecution", MAX(${schema.runCompleted}) AS "lastExecution" ` +
    `FROM ${schema.runObject} WHERE ${schema.runVersionId} = '${escapeSqlLiteral(query.versionId)}' ` +
    `AND ${schema.runOrganizationId} = '${escapeSqlLiteral(query.organizationId)}' ` +
    `AND ${schema.runScheduled} >= timestamp with time zone '${escapeSqlLiteral(query.from)}' ` +
    `GROUP BY ${schema.runStatus}, ${schema.runErrorReason}`
  );
}

function normaliseBreakdown(record: DataCloudRecord, schema: FlowDmoSchema): DataCloudRecord {
  return {
    ...record,
    runStatus: record[schema.runStatus],
    errorReason: record[schema.runErrorReason],
  };
}

function isFlowMetricsError(error: unknown): boolean {
  return error instanceof Error && error.name.startsWith('FlowDataCloud');
}

function isDmoNotFound(error: unknown): boolean {
  const parsed = httpErrorSchema.safeParse(error);
  if (!parsed.success) {
    return false;
  }
  const { errorCode, name, status, statusCode } = parsed.data;
  const safeStatuses = [statusCode, status].flatMap((candidate) => {
    const validated = httpStatusSchema.safeParse(candidate);
    return validated.success ? [validated.data] : [];
  });
  const safeCodes = [errorCode, name].flatMap((candidate) => {
    const validated = httpCodeSchema.safeParse(candidate);
    return validated.success ? [validated.data] : [];
  });
  return safeStatuses.includes(404) || safeCodes.some((code) => code === 'NOT_FOUND' || code === 'ERROR_HTTP_404');
}

function requireVersion(
  resolved: ResolvedDataCloudVersion | null,
  name: string,
  version: number
): ResolvedDataCloudVersion {
  if (resolved === null) {
    throw flowDataCloudMetricsUnavailable(
      `Data Cloud Flow metrics are not available for "${name}" version ${version}.`
    );
  }
  return resolved;
}

export class DataCloudFlowMetricsGateway implements FlowRuntimeMetricsGateway {
  private readonly dmoBaseUrl: string;
  private readonly queryClient: DataCloudSqlQueryClient;

  public constructor(private readonly connection: Connection) {
    this.dmoBaseUrl = `/services/data/v${connection.version}/ssot/data-model-objects`;
    this.queryClient = new DataCloudSqlQueryClient(connection);
  }

  public async getMetrics(request: FlowRuntimeMetricsRequest): Promise<FlowRuntimeMetrics> {
    const validatedRequest = validateRuntimeMetricsRequest(request);
    const from = new Date(Date.now() - validatedRequest.windowDays * 86_400_000).toISOString();
    try {
      const organizationId = this.requireSourceOrganizationId();
      const resolved = await this.resolveVersion(validatedRequest, organizationId);
      const breakdowns = await this.loadBreakdowns(resolved, from, organizationId);
      return summariseFlowRuntimeMetrics(validatedRequest, from, breakdowns);
    } catch (error: unknown) {
      if (isFlowMetricsError(error)) {
        throw error;
      }
      throw flowDataCloudMetricsFailed(
        `Could not query Data Cloud runtime metrics for Flow "${validatedRequest.apiName}".`,
        error
      );
    }
  }

  private async resolveVersion(
    request: FlowRuntimeMetricsRequest,
    organizationId: string
  ): Promise<ResolvedDataCloudVersion> {
    const name = qualifiedFlowName(request.apiName, request.namespace);
    const lookup = { name, organizationId, version: request.version };
    if (await this.hasRequiredDmos(FLOW_DMO_SCHEMAS[0])) {
      return requireVersion(await this.findVersion(FLOW_DMO_SCHEMAS[0], lookup), name, request.version);
    }
    if (await this.hasRequiredDmos(FLOW_DMO_SCHEMAS[1])) {
      return requireVersion(await this.findVersion(FLOW_DMO_SCHEMAS[1], lookup), name, request.version);
    }
    throw flowDataCloudMetricsFailed(
      'Data Cloud did not confirm access to every required Flow, Flow Version and Flow Run DMO.'
    );
  }

  private async findVersion(schema: FlowDmoSchema, lookup: VersionLookup): Promise<ResolvedDataCloudVersion | null> {
    const flows = await this.queryClient.query(buildFlowQuery(schema, lookup.name, lookup.organizationId));
    const flowId = singleIdentifier(flows, { field: schema.flowId, label: 'Flow', name: lookup.name });
    if (flowId === null) {
      return null;
    }
    const versions = await this.queryClient.query(buildVersionQuery(schema, flowId, lookup));
    const versionId = singleIdentifier(versions, {
      field: schema.versionId,
      label: 'Flow version',
      name: `${lookup.name} v${lookup.version}`,
    });
    return versionId === null ? null : { schema, versionId };
  }

  private async hasDmo(objectName: string): Promise<boolean> {
    try {
      await this.connection.request(`${this.dmoBaseUrl}/${encodeURIComponent(objectName)}`);
      return true;
    } catch (error: unknown) {
      if (isDmoNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private async hasRequiredDmos(schema: FlowDmoSchema): Promise<boolean> {
    const availability = await [schema.flowObject, schema.versionObject, schema.runObject].reduce(
      async (previous, objectName) => [...(await previous), await this.hasDmo(objectName)],
      Promise.resolve([] as boolean[])
    );
    return availability.every(Boolean);
  }

  private async loadBreakdowns(
    resolved: ResolvedDataCloudVersion,
    from: string,
    organizationId: string
  ): Promise<FlowRuntimeMetricBreakdown[]> {
    const records = await this.queryClient.query(
      buildMetricsQuery(resolved.schema, { from, organizationId, versionId: resolved.versionId })
    );
    return records.map((record) => parseFlowRuntimeBreakdown(normaliseBreakdown(record, resolved.schema)));
  }

  private requireSourceOrganizationId(): string {
    const parsed = z.string().min(1).safeParse(this.connection.getAuthInfoFields().orgId);
    if (!parsed.success) {
      throw flowDataCloudMetricsFailed('The authenticated target org does not expose its organization ID.');
    }
    return parsed.data;
  }
}
