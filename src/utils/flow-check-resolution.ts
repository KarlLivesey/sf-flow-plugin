/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowCheckFailed } from '../errors/flow-errors.js';
import type { FlowCheckKind, FlowCheckRequest } from '../types/flow-check.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowVersion } from '../types/flow.js';
import type { FlowProgressReporter } from './flow-progress.js';
import { selectFlowDefinition } from './flow-state.js';

export interface ResolvedCheckFlow {
  apiName: string;
  namespace: string | null;
  versionNumber: number;
}

interface ResolveFlowCheckContext {
  request: FlowCheckRequest;
  apiName: string;
  progress: FlowProgressReporter;
}

export function requiresFlowDescription(checks: ReadonlyArray<FlowCheckKind>): boolean {
  return checks.some((check) => ['metrics', 'subflows'].includes(check));
}

function referencedVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  selector: 'active' | 'latest'
): FlowVersion {
  const versionId = selector === 'active' ? definition.activeVersionId : definition.latestVersionId;
  const version = versions.find((item) => item.id === versionId);
  if (version === undefined) {
    throw flowCheckFailed(`Flow "${definition.apiName}" does not have an ${selector} version.`);
  }
  return version;
}

function selectedVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  request: FlowCheckRequest
): FlowVersion {
  if (request.version === 'active' || request.version === 'latest') {
    return referencedVersion(definition, versions, request.version);
  }
  const version = versions.find((item) => item.versionNumber === request.version);
  if (version === undefined) {
    throw flowCheckFailed(`Flow "${definition.apiName}" does not have version ${request.version}.`);
  }
  return version;
}

export async function resolveFlowCheckRoot(
  gateway: FlowDefinitionGateway,
  context: ResolveFlowCheckContext
): Promise<ResolvedCheckFlow> {
  const { request, apiName, progress } = context;
  progress('resolving-flow', apiName);
  const lookup = request.namespace === undefined ? { apiName } : { apiName, namespace: request.namespace };
  const definition = selectFlowDefinition(apiName, await gateway.findDefinitions(lookup));
  progress('loading-versions', `${apiName} (${String(request.version)})`);
  const version = selectedVersion(definition, await gateway.findVersions(definition.id), request);
  return { apiName: definition.apiName, namespace: definition.namespace, versionNumber: version.versionNumber };
}
