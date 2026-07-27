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
import { parseFlowVersionDateFilter, parseSalesforceDateTime } from '../utils/flow-date.js';
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

interface VersionDateBounds {
  createdBefore: number | null;
  createdAfter: number | null;
  modifiedBefore: number | null;
  modifiedAfter: number | null;
}

function dateBounds(request: FlowVersionsRequest): VersionDateBounds {
  return {
    createdBefore: request.createdBefore === undefined ? null : parseFlowVersionDateFilter(request.createdBefore),
    createdAfter: request.createdAfter === undefined ? null : parseFlowVersionDateFilter(request.createdAfter),
    modifiedBefore: request.modifiedBefore === undefined ? null : parseFlowVersionDateFilter(request.modifiedBefore),
    modifiedAfter: request.modifiedAfter === undefined ? null : parseFlowVersionDateFilter(request.modifiedAfter),
  };
}

function withinDateBounds(version: FlowVersion, bounds: VersionDateBounds): boolean {
  const created = parseSalesforceDateTime(version.createdDate);
  const modified = parseSalesforceDateTime(version.lastModifiedDate);
  return (
    (bounds.createdBefore === null || created < bounds.createdBefore) &&
    (bounds.createdAfter === null || created > bounds.createdAfter) &&
    (bounds.modifiedBefore === null || modified < bounds.modifiedBefore) &&
    (bounds.modifiedAfter === null || modified > bounds.modifiedAfter)
  );
}

function sortSelectedVersions(versions: FlowVersion[], request: FlowVersionsRequest): FlowVersion[] {
  const direction = request.order === 'asc' ? 1 : -1;
  return versions.sort((left, right) => {
    const comparison =
      request.sort === 'version'
        ? left.versionNumber - right.versionNumber
        : (request.sort === 'created' ? left.createdDate : left.lastModifiedDate).localeCompare(
            request.sort === 'created' ? right.createdDate : right.lastModifiedDate
          );
    return direction * (comparison || left.versionNumber - right.versionNumber);
  });
}

function createResult(
  request: FlowVersionsRequest,
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionsResult {
  const statuses = new Set<string>(request.statuses);
  const statusFiltered =
    request.statuses.length === 0 ? [...versions] : versions.filter((version) => statuses.has(version.status));
  const bounds = dateBounds(request);
  const dateFiltered = statusFiltered.filter((version) => withinDateBounds(version, bounds));
  const latest = [...dateFiltered].sort((left, right) => left.versionNumber - right.versionNumber);
  const limited = request.limit === undefined ? latest : latest.slice(-request.limit);
  const selected = sortSelectedVersions(limited, request);
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion: resolveVersionNumber(definition.apiName, definition.activeVersionId, versions),
    latestVersion: resolveVersionNumber(definition.apiName, definition.latestVersionId, versions),
    statuses: request.statuses,
    createdBefore: request.createdBefore ?? null,
    createdAfter: request.createdAfter ?? null,
    modifiedBefore: request.modifiedBefore ?? null,
    modifiedAfter: request.modifiedAfter ?? null,
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
      (request.modifiedBefore !== undefined &&
        !flowVersionDateFilterSchema.safeParse(request.modifiedBefore).success) ||
      (request.modifiedAfter !== undefined && !flowVersionDateFilterSchema.safeParse(request.modifiedAfter).success) ||
      (request.createdBefore !== undefined &&
        request.createdAfter !== undefined &&
        parseFlowVersionDateFilter(request.createdAfter) >= parseFlowVersionDateFilter(request.createdBefore)) ||
      (request.modifiedBefore !== undefined &&
        request.modifiedAfter !== undefined &&
        parseFlowVersionDateFilter(request.modifiedAfter) >= parseFlowVersionDateFilter(request.modifiedBefore)) ||
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
