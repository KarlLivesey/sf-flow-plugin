/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import type { z } from 'zod';

import { flowMutationFailed, flowMutationPermissionDenied, flowQueryFailed } from '../errors/flow-errors.js';
import {
  flowDefinitionRecordSchema,
  flowDependencyTypeSchema,
  flowMetadataRecordSchema,
  flowVersionRecordSchema,
  metadataComponentDependencyRecordSchema,
  positiveFlowVersionSchema,
  toolingObjectPermissionSchema,
  toolingQueryResultSchema,
} from '../schemas/flow.js';
import type {
  FlowDependencyQueryDirection,
  FlowDependencyQueryResult,
  IndexedFlowDependency,
  JsonObject,
  MetadataComponentDependencyRecord,
} from '../types/flow-analysis.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowDefinitionMetadataUpdate,
  FlowMutationOperation,
  FlowVersion,
  FlowVersionNumber,
  ToolingQueryResult,
} from '../types/flow.js';
import { validateFlowApiName, validateNamespace, validateSalesforceId } from '../utils/flow-name-validation.js';

interface MutationOperationDetails {
  objectName: 'Flow' | 'FlowDefinition';
  permission: 'deletable' | 'updateable';
  description: string;
}

function mutationOperationDetails(operation: FlowMutationOperation): MutationOperationDetails {
  return operation === 'update-definition'
    ? { objectName: 'FlowDefinition', permission: 'updateable', description: 'update Flow definitions' }
    : { objectName: 'Flow', permission: 'deletable', description: 'delete Flow versions' };
}

function parseSalesforceValue<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw flowQueryFailed(`Salesforce returned a malformed ${label}.`);
  }
  return result.data;
}

function parseQueryResult(value: unknown): ToolingQueryResult<unknown> {
  const result = parseSalesforceValue(toolingQueryResultSchema, value, 'Tooling API query result');
  const { done, totalSize, records, nextRecordsUrl } = result;
  return nextRecordsUrl === undefined ? { done, totalSize, records } : { done, totalSize, records, nextRecordsUrl };
}

function parseDefinition(value: unknown): FlowDefinition {
  const external = parseSalesforceValue(flowDefinitionRecordSchema, value, 'FlowDefinition record');
  return {
    id: external.Id,
    apiName: external.DeveloperName,
    namespace: external.NamespacePrefix,
    activeVersionId: external.ActiveVersionId,
    latestVersionId: external.LatestVersionId,
  };
}

function parseVersion(value: unknown): FlowVersion {
  const external = parseSalesforceValue(flowVersionRecordSchema, value, 'Flow version record');
  return {
    id: external.Id,
    definitionId: external.DefinitionId,
    versionNumber: external.VersionNumber,
    status: external.Status,
    label: external.MasterLabel,
    processType: external.ProcessType,
    createdDate: external.CreatedDate,
    lastModifiedDate: external.LastModifiedDate,
  };
}

function parseMetadata(value: unknown, versionId: string): JsonObject {
  const external = parseSalesforceValue(flowMetadataRecordSchema, value, 'Flow metadata record');
  if (external.Id !== versionId) {
    throw flowQueryFailed('Salesforce returned metadata for an unexpected Flow version.');
  }
  return external.Metadata;
}

function dependencyFields(
  external: MetadataComponentDependencyRecord,
  direction: FlowDependencyQueryDirection
): Omit<IndexedFlowDependency, 'direction'> {
  if (direction === 'uses') {
    return {
      componentId: external.RefMetadataComponentId,
      name: external.RefMetadataComponentName,
      namespace: external.RefMetadataComponentNamespace,
      type: external.RefMetadataComponentType,
    };
  }
  return {
    componentId: external.MetadataComponentId,
    name: external.MetadataComponentName,
    namespace: external.MetadataComponentNamespace,
    type: external.MetadataComponentType,
  };
}

function parseDependency(value: unknown, direction: FlowDependencyQueryDirection): IndexedFlowDependency {
  const external = parseSalesforceValue(metadataComponentDependencyRecordSchema, value, 'metadata dependency record');
  return { direction, ...dependencyFields(external, direction) };
}

export function buildDefinitionQuery(lookup: FlowDefinitionLookup): string {
  const fields = 'Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId';
  const namespaceClause =
    lookup.namespace === undefined
      ? ''
      : lookup.namespace === null
      ? ' AND NamespacePrefix = null'
      : ` AND NamespacePrefix = '${lookup.namespace}'`;
  return `SELECT ${fields} FROM FlowDefinition WHERE DeveloperName = '${lookup.apiName}'${namespaceClause}`;
}

function buildAllDefinitionsQuery(): string {
  return 'SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinition ORDER BY DeveloperName ASC';
}

function buildVersionQuery(definitionId: string): string {
  const fields = 'Id, DefinitionId, VersionNumber, Status, MasterLabel, ProcessType, CreatedDate, LastModifiedDate';
  return `SELECT ${fields} FROM Flow WHERE DefinitionId = '${definitionId}' ORDER BY VersionNumber ASC`;
}

function buildAllVersionsQuery(): string {
  return 'SELECT Id, DefinitionId, VersionNumber, Status, MasterLabel, ProcessType, CreatedDate, LastModifiedDate FROM Flow ORDER BY DefinitionId ASC, VersionNumber ASC';
}

const DEPENDENCY_FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType';
const DEPENDENCY_QUERY_LIMIT = 2000;

function buildDependencyQuery(
  definitionId: string,
  direction: FlowDependencyQueryDirection,
  types: ReadonlyArray<string>
): string {
  const idField = direction === 'uses' ? 'MetadataComponentId' : 'RefMetadataComponentId';
  const typeField = direction === 'uses' ? 'RefMetadataComponentType' : 'MetadataComponentType';
  const uniqueTypes = [...new Set(types)].sort();
  const typeClause =
    uniqueTypes.length === 0 ? '' : ` AND ${typeField} IN (${uniqueTypes.map((type) => `'${type}'`).join(', ')})`;
  return (
    `SELECT ${DEPENDENCY_FIELDS} FROM MetadataComponentDependency ` +
    `WHERE ${idField} = '${definitionId}'${typeClause} LIMIT ${DEPENDENCY_QUERY_LIMIT}`
  );
}

function buildMetadataQuery(versionId: string): string {
  return `SELECT Id, Metadata FROM Flow WHERE Id = '${versionId}'`;
}

export class ToolingFlowDefinitionGateway implements FlowDefinitionGateway {
  public constructor(private readonly connection: Connection) {}

  public async assertMutationAllowed(operation: FlowMutationOperation): Promise<void> {
    const details = mutationOperationDetails(operation);
    const permission = await this.describePermissions(details.objectName);
    if (!permission[details.permission]) {
      throw flowMutationPermissionDenied(details.description);
    }
  }

  public async findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>> {
    validateFlowApiName(lookup.apiName);
    if (typeof lookup.namespace === 'string') {
      validateNamespace(lookup.namespace);
    }
    const records = await this.queryAll(buildDefinitionQuery(lookup));
    return records.map(parseDefinition);
  }

  public async findAllDefinitions(): Promise<ReadonlyArray<FlowDefinition>> {
    const records = await this.queryAll(buildAllDefinitionsQuery());
    return records.map(parseDefinition);
  }

  public async findVersions(definitionId: string): Promise<ReadonlyArray<FlowVersion>> {
    validateSalesforceId(definitionId, 'Flow definition ID');
    const records = await this.queryAll(buildVersionQuery(definitionId));
    const versions = records.map(parseVersion);
    if (versions.some((version) => version.definitionId !== definitionId)) {
      throw flowQueryFailed('Salesforce returned a Flow version for an unexpected definition.');
    }
    return versions;
  }

  public async findAllVersions(): Promise<ReadonlyArray<FlowVersion>> {
    const records = await this.queryAll(buildAllVersionsQuery());
    return records.map(parseVersion);
  }

  public async findDependencies(
    definitionId: string,
    direction: FlowDependencyQueryDirection,
    types: ReadonlyArray<string>
  ): Promise<FlowDependencyQueryResult> {
    validateSalesforceId(definitionId, 'Flow definition ID');
    if (!types.every((type) => flowDependencyTypeSchema.safeParse(type).success)) {
      throw flowQueryFailed('The metadata dependency type filter is invalid.');
    }
    const records = await this.queryAll(buildDependencyQuery(definitionId, direction, types));
    return {
      dependencies: records.map((record) => parseDependency(record, direction)),
      reachedLimit: records.length === DEPENDENCY_QUERY_LIMIT,
      limit: DEPENDENCY_QUERY_LIMIT,
    };
  }

  public async getVersionMetadata(versionId: string): Promise<JsonObject> {
    validateSalesforceId(versionId, 'Flow version ID');
    const records = await this.queryAll(buildMetadataQuery(versionId));
    if (records.length !== 1) {
      throw flowQueryFailed('Salesforce did not return exactly one Flow metadata record.');
    }
    return parseMetadata(records[0], versionId);
  }

  public async setActiveVersion(definitionId: string, versionNumber: FlowVersionNumber | null): Promise<void> {
    validateSalesforceId(definitionId, 'Flow definition ID');
    if (versionNumber !== null && !positiveFlowVersionSchema.safeParse(versionNumber).success) {
      throw flowMutationFailed('The active Flow version must be a positive whole number.');
    }
    const update: FlowDefinitionMetadataUpdate = { Metadata: { activeVersionNumber: versionNumber ?? 0 } };
    const url = `${this.connection.baseUrl()}/tooling/sobjects/FlowDefinition/${definitionId}`;
    try {
      await this.connection.request({ method: 'PATCH', url, body: JSON.stringify(update) });
    } catch (error: unknown) {
      throw flowMutationFailed('Salesforce rejected the Flow definition update.', error);
    }
  }

  public async deleteVersion(versionId: string): Promise<void> {
    validateSalesforceId(versionId, 'Flow version ID');
    const url = `${this.connection.baseUrl()}/tooling/sobjects/Flow/${versionId}`;
    try {
      await this.connection.request({ method: 'DELETE', url });
    } catch (error: unknown) {
      throw flowMutationFailed('Salesforce rejected the Flow version deletion.', error);
    }
  }

  private async queryAll(soql: string): Promise<ReadonlyArray<unknown>> {
    try {
      const firstPage: unknown = await this.connection.tooling.query(soql);
      return await this.collectPages(parseQueryResult(firstPage), []);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'FlowQueryFailed') {
        throw error;
      }
      throw flowQueryFailed('The Salesforce Tooling API query failed.', error);
    }
  }

  private async describePermissions(objectName: string): Promise<{ deletable: boolean; updateable: boolean }> {
    try {
      const response: unknown = await this.connection.tooling.describe(objectName);
      return parseSalesforceValue(toolingObjectPermissionSchema, response, `${objectName} permission description`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'FlowQueryFailed') {
        throw error;
      }
      throw flowQueryFailed(`The Salesforce Tooling API could not describe ${objectName} permissions.`, error);
    }
  }
  private async collectPages(
    page: ToolingQueryResult<unknown>,
    accumulated: ReadonlyArray<unknown>
  ): Promise<ReadonlyArray<unknown>> {
    const records = [...accumulated, ...page.records];
    if (page.done) {
      return records;
    }
    if (page.nextRecordsUrl === undefined) {
      throw flowQueryFailed('Salesforce omitted the URL for the next Tooling API query page.');
    }
    const nextPage: unknown = await this.connection.tooling.queryMore(page.nextRecordsUrl);
    return this.collectPages(parseQueryResult(nextPage), records);
  }
}
