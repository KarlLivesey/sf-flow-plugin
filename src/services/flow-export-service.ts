/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowExportFailed } from '../errors/flow-errors.js';
import type { FlowComparisonVersionSelector, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowVersion } from '../types/flow.js';
import type { FlowExportArtifact, FlowExportRequest } from '../types/flow-inspection.js';
import { renderFlowMetadataXml } from '../utils/flow-metadata-xml.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { selectFlowDefinition } from '../utils/flow-state.js';

function selectVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  selector: FlowComparisonVersionSelector
): FlowVersion {
  const id =
    selector === 'active'
      ? definition.activeVersionId
      : selector === 'latest'
      ? definition.latestVersionId
      : versions.find((version) => version.versionNumber === selector)?.id;
  const version = versions.find((candidate) => candidate.id === id);
  if (version === undefined) {
    throw flowExportFailed(`Flow "${definition.apiName}" does not have the requested ${String(selector)} version.`);
  }
  return version;
}

async function exportFlow(
  gateway: FlowDefinitionGateway & FlowMetadataGateway,
  request: FlowExportRequest,
  progress: FlowProgressReporter
): Promise<FlowExportArtifact> {
  progress('resolving-flow', request.apiName);
  const lookup =
    request.namespace === undefined
      ? { apiName: request.apiName }
      : { apiName: request.apiName, namespace: request.namespace };
  const definition = selectFlowDefinition(request.apiName, await gateway.findDefinitions(lookup));
  progress('loading-versions', `${request.apiName} (${String(request.version)})`);
  const version = selectVersion(definition, await gateway.findVersions(definition.id), request.version);
  progress('loading-metadata', `${request.apiName} v${version.versionNumber}`);
  const metadata = await gateway.getVersionMetadata(version.id);
  const content = renderFlowMetadataXml(metadata, request.status);
  return {
    content,
    result: {
      apiName: definition.apiName,
      namespace: definition.namespace,
      definitionId: definition.id,
      requestedVersion: request.version,
      resolvedVersion: version.versionNumber,
      sourceStatus: version.status,
      exportedStatus: request.status === 'active' ? 'Active' : 'Draft',
      format: request.format,
      outputFile: request.outputFile,
      bytes: Buffer.byteLength(content, 'utf8'),
      targetOrg: request.targetOrg,
    },
  };
}

export class FlowExportService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async export(
    request: FlowExportRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowExportArtifact> {
    try {
      return await exportFlow(this.gateway, request, progress);
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow')) {
        throw error;
      }
      throw flowExportFailed(`Failed to export Flow "${request.apiName}".`, error);
    }
  }
}
