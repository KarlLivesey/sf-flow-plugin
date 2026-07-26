/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowQueryFailed } from '../errors/flow-errors.js';
import {
  flowSortOrderSchema,
  flowVersionDateFilterSchema,
  flowVersionSortSchema,
  flowVersionStatusFilterSchema,
  positiveFlowVersionSchema,
} from '../schemas/flow.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowVersion,
  FlowVersionsRequest,
  FlowVersionsResult,
} from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

function createLookup(request: FlowVersionsRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function versionSummaries(
  versions: ReadonlyArray<FlowVersion>,
  definition: FlowDefinition
): FlowVersionsResult['versions'] {
  return versions.map((version) => ({
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    label: version.label,
    processType: version.processType,
    createdDate: version.createdDate,
    lastModifiedDate: version.lastModifiedDate,
    active: version.id === definition.activeVersionId,
    latest: version.id === definition.latestVersionId,
  }));
}

function createResult(
  request: FlowVersionsRequest,
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionsResult {
  const statuses = new Set<string>(request.statuses);
  const statusFiltered =
    request.statuses.length === 0 ? [...versions] : versions.filter((version) => statuses.has(version.status));
  const createdBefore = request.createdBefore === undefined ? null : Date.parse(request.createdBefore);
  const createdAfter = request.createdAfter === undefined ? null : Date.parse(request.createdAfter);
  const dateFiltered = statusFiltered.filter((version) => {
    const created = Date.parse(version.createdDate);
    return (createdBefore === null || created < createdBefore) && (createdAfter === null || created > createdAfter);
  });
  const latest = [...dateFiltered].sort((left, right) => left.versionNumber - right.versionNumber);
  const limited = request.limit === undefined ? latest : latest.slice(-request.limit);
  const direction = request.order === 'asc' ? 1 : -1;
  const selected = limited.sort((left, right) => {
    const comparison =
      request.sort === 'version'
        ? left.versionNumber - right.versionNumber
        : (request.sort === 'created' ? left.createdDate : left.lastModifiedDate).localeCompare(
            request.sort === 'created' ? right.createdDate : right.lastModifiedDate
          );
    return direction * (comparison || left.versionNumber - right.versionNumber);
  });
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion: resolveVersionNumber(definition.apiName, definition.activeVersionId, versions),
    latestVersion: resolveVersionNumber(definition.apiName, definition.latestVersionId, versions),
    statuses: request.statuses,
    createdBefore: request.createdBefore ?? null,
    createdAfter: request.createdAfter ?? null,
    sort: request.sort,
    order: request.order,
    versions: versionSummaries(selected, definition),
    targetOrg: request.targetOrg,
  };
}

export class FlowVersionsService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async getVersions(
    request: FlowVersionsRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowVersionsResult> {
    if (
      !request.statuses.every((status) => flowVersionStatusFilterSchema.safeParse(status).success) ||
      (request.createdBefore !== undefined && !flowVersionDateFilterSchema.safeParse(request.createdBefore).success) ||
      (request.createdAfter !== undefined && !flowVersionDateFilterSchema.safeParse(request.createdAfter).success) ||
      (request.createdBefore !== undefined &&
        request.createdAfter !== undefined &&
        Date.parse(request.createdAfter) >= Date.parse(request.createdBefore)) ||
      !flowVersionSortSchema.safeParse(request.sort).success ||
      !flowSortOrderSchema.safeParse(request.order).success ||
      (request.limit !== undefined && !positiveFlowVersionSchema.safeParse(request.limit).success)
    ) {
      throw flowQueryFailed('The Flow version filters are invalid.');
    }
    progress('resolving-flow', request.apiName);
    const definitions = await this.gateway.findDefinitions(createLookup(request));
    const definition = selectFlowDefinition(request.apiName, definitions);
    progress('loading-versions', `${qualifiedFlowName(definition.apiName, definition.namespace)} (all versions)`);
    const versions = await this.gateway.findVersions(definition.id);
    return createResult(request, definition, versions);
  }
}
