/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import type { FlowDmoSchema } from '../constants/data-cloud-flow-dmo-schemas.js';
import { flowDataCloudMetricsFailed } from '../errors/flow-errors.js';

export interface VersionLookup {
  name: string;
  organizationId: string;
  version: number;
}

export interface MetricsQuery {
  from: string;
  organizationId: string;
  versionId: string;
}

interface CrmSourceScope {
  dataSourceId: string;
  dataSourceObjectId: string;
  sourceObjectName: string;
}

const sqlIdentifierSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u);

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function quoteSqlIdentifier(value: string): string {
  const parsed = sqlIdentifierSchema.safeParse(value);
  if (!parsed.success) {
    throw flowDataCloudMetricsFailed(`The Data Cloud SQL identifier "${value}" is invalid.`);
  }
  return `"${parsed.data}"`;
}

function dataSourceIds(organizationId: string): string {
  return ['Salesforce_Home', `Salesforce_${organizationId}`].map((value) => `'${escapeSqlLiteral(value)}'`).join(', ');
}

function crmSourcePredicate(scope: CrmSourceScope, organizationId: string): string {
  return (
    `${quoteSqlIdentifier(scope.dataSourceId)} IN (${dataSourceIds(organizationId)}) ` +
    `AND ${quoteSqlIdentifier(scope.dataSourceObjectId)} = '${escapeSqlLiteral(scope.sourceObjectName)}'`
  );
}

export function buildFlowQuery(schema: FlowDmoSchema, name: string, organizationId: string): string {
  const sourceScope = {
    dataSourceId: schema.flowDataSourceId,
    dataSourceObjectId: schema.flowDataSourceObjectId,
    sourceObjectName: schema.flowSourceObjectName,
  };
  return (
    `SELECT ${quoteSqlIdentifier(schema.flowId)}, ${quoteSqlIdentifier(schema.flowName)} ` +
    `FROM ${quoteSqlIdentifier(schema.flowObject)} ` +
    `WHERE ${quoteSqlIdentifier(schema.flowName)} = '${escapeSqlLiteral(name)}' ` +
    `AND ${crmSourcePredicate(sourceScope, organizationId)} LIMIT 2`
  );
}

export function buildVersionQuery(schema: FlowDmoSchema, flowId: string, lookup: VersionLookup): string {
  const sourceScope = {
    dataSourceId: schema.versionDataSourceId,
    dataSourceObjectId: schema.versionDataSourceObjectId,
    sourceObjectName: schema.versionSourceObjectName,
  };
  return (
    `SELECT ${quoteSqlIdentifier(schema.versionId)}, ${quoteSqlIdentifier(schema.versionNumber)} ` +
    `FROM ${quoteSqlIdentifier(schema.versionObject)} ` +
    `WHERE ${quoteSqlIdentifier(schema.versionFlowId)} = '${escapeSqlLiteral(flowId)}' ` +
    `AND ${quoteSqlIdentifier(schema.versionNumber)} = ${lookup.version} ` +
    `AND ${crmSourcePredicate(sourceScope, lookup.organizationId)} LIMIT 2`
  );
}

function durationFields(schema: FlowDmoSchema): string {
  return schema.runDuration === undefined
    ? ''
    : `, AVG(${quoteSqlIdentifier(schema.runDuration)}) AS ${quoteSqlIdentifier('averageDurationMilliseconds')}` +
        `, MIN(${quoteSqlIdentifier(schema.runDuration)}) AS ${quoteSqlIdentifier('minimumDurationMilliseconds')}` +
        `, MAX(${quoteSqlIdentifier(schema.runDuration)}) AS ${quoteSqlIdentifier('maximumDurationMilliseconds')}`;
}

export function buildMetricsQuery(schema: FlowDmoSchema, query: MetricsQuery): string {
  return (
    `SELECT ${quoteSqlIdentifier(schema.runStatus)}, ${quoteSqlIdentifier(schema.runErrorReason)}` +
    `, COUNT(${quoteSqlIdentifier(schema.runId)}) AS ${quoteSqlIdentifier('executions')}${durationFields(schema)}` +
    `, MIN(${quoteSqlIdentifier(schema.runScheduled)}) AS ${quoteSqlIdentifier('firstExecution')}` +
    `, MAX(${quoteSqlIdentifier(schema.runCompleted)}) AS ${quoteSqlIdentifier('lastExecution')} ` +
    `FROM ${quoteSqlIdentifier(schema.runObject)} ` +
    `WHERE ${quoteSqlIdentifier(schema.runVersionId)} = '${escapeSqlLiteral(query.versionId)}' ` +
    `AND ${quoteSqlIdentifier(schema.runOrganizationId)} = '${escapeSqlLiteral(query.organizationId)}' ` +
    `AND ${quoteSqlIdentifier(schema.runScheduled)} >= timestamp with time zone '${escapeSqlLiteral(query.from)}' ` +
    `GROUP BY ${quoteSqlIdentifier(schema.runStatus)}, ${quoteSqlIdentifier(schema.runErrorReason)}`
  );
}
