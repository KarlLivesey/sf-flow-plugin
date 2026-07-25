/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowVersion,
  FlowVersionsResult,
  NamedFlowRequest,
} from '../types/flow.js';
import { resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

function createLookup(request: NamedFlowRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function createResult(
  request: NamedFlowRequest,
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionsResult {
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    activeVersion: resolveVersionNumber(definition.apiName, definition.activeVersionId, versions),
    latestVersion: resolveVersionNumber(definition.apiName, definition.latestVersionId, versions),
    versions: versions.map((version) => ({
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

  public async getVersions(request: NamedFlowRequest): Promise<FlowVersionsResult> {
    const definitions = await this.gateway.findDefinitions(createLookup(request));
    const definition = selectFlowDefinition(request.apiName, definitions);
    const versions = await this.gateway.findVersions(definition.id);
    return createResult(request, definition, versions);
  }
}
