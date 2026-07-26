/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowQueryFailed } from '../errors/flow-errors.js';
import { flowVersionStatusFilterSchema, positiveFlowVersionSchema } from '../schemas/flow.js';
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

function createResult(
  request: FlowVersionsRequest,
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionsResult {
  const statuses = new Set<string>(request.statuses);
  const filtered =
    request.statuses.length === 0 ? [...versions] : versions.filter((version) => statuses.has(version.status));
  const selected = request.limit === undefined ? filtered : filtered.slice(-request.limit);
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion: resolveVersionNumber(definition.apiName, definition.activeVersionId, versions),
    latestVersion: resolveVersionNumber(definition.apiName, definition.latestVersionId, versions),
    versions: selected.map((version) => ({
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      label: version.label,
      processType: version.processType,
      createdDate: version.createdDate,
      lastModifiedDate: version.lastModifiedDate,
      active: version.id === definition.activeVersionId,
      latest: version.id === definition.latestVersionId,
    })),
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
