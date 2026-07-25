import type { Connection } from '@salesforce/core';
import type { z } from 'zod';

import { flowActivationFailed } from '../errors/flow-errors.js';
import {
  flowDefinitionRecordSchema,
  flowVersionRecordSchema,
  positiveFlowVersionSchema,
  toolingQueryResultSchema,
} from '../schemas/flow.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowDefinitionMetadataUpdate,
  FlowVersion,
  FlowVersionNumber,
  ToolingQueryResult,
} from '../types/flow.js';
import { validateFlowApiName, validateNamespace, validateSalesforceId } from '../utils/flow-name-validation.js';

function parseSalesforceValue<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw flowActivationFailed(`Salesforce returned a malformed ${label}.`);
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
  };
}

function buildDefinitionQuery(lookup: FlowDefinitionLookup): string {
  const fields = 'Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId';
  const namespaceClause = lookup.namespace === undefined ? '' : ` AND NamespacePrefix = '${lookup.namespace}'`;
  return `SELECT ${fields} FROM FlowDefinition WHERE DeveloperName = '${lookup.apiName}'${namespaceClause}`;
}

function buildVersionQuery(definitionId: string): string {
  const fields = 'Id, DefinitionId, VersionNumber, Status, MasterLabel, ProcessType';
  return `SELECT ${fields} FROM Flow WHERE DefinitionId = '${definitionId}' ORDER BY VersionNumber ASC`;
}

export class ToolingFlowDefinitionGateway implements FlowDefinitionGateway {
  public constructor(private readonly connection: Connection) {}

  public async findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>> {
    validateFlowApiName(lookup.apiName);
    if (lookup.namespace !== undefined) {
      validateNamespace(lookup.namespace);
    }
    const records = await this.queryAll(buildDefinitionQuery(lookup));
    return records.map(parseDefinition);
  }

  public async findVersions(definitionId: string): Promise<ReadonlyArray<FlowVersion>> {
    validateSalesforceId(definitionId, 'Flow definition ID');
    const records = await this.queryAll(buildVersionQuery(definitionId));
    const versions = records.map(parseVersion);
    if (versions.some((version) => version.definitionId !== definitionId)) {
      throw flowActivationFailed('Salesforce returned a Flow version for an unexpected definition.');
    }
    return versions;
  }

  public async updateActiveVersion(definitionId: string, versionNumber: FlowVersionNumber): Promise<void> {
    validateSalesforceId(definitionId, 'Flow definition ID');
    if (!positiveFlowVersionSchema.safeParse(versionNumber).success) {
      throw flowActivationFailed('The active Flow version must be a positive whole number.');
    }
    const update: FlowDefinitionMetadataUpdate = { Metadata: { activeVersionNumber: versionNumber } };
    const url = `${this.connection.baseUrl()}/tooling/sobjects/FlowDefinition/${definitionId}`;
    try {
      await this.connection.request({ method: 'PATCH', url, body: JSON.stringify(update) });
    } catch (error: unknown) {
      throw flowActivationFailed('Salesforce rejected the Flow activation update.', error);
    }
  }

  private async queryAll(soql: string): Promise<ReadonlyArray<unknown>> {
    try {
      const firstPage: unknown = await this.connection.tooling.query(soql);
      return await this.collectPages(parseQueryResult(firstPage), []);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'FlowActivationFailed') {
        throw error;
      }
      throw flowActivationFailed('The Salesforce Tooling API query failed.', error);
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
      throw flowActivationFailed('Salesforce omitted the URL for the next Tooling API query page.');
    }
    const nextPage: unknown = await this.connection.tooling.queryMore(page.nextRecordsUrl);
    return this.collectPages(parseQueryResult(nextPage), records);
  }
}
