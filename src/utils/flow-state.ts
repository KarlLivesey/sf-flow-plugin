/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDefinitionAmbiguous, flowDefinitionNotFound, flowQueryFailed } from '../errors/flow-errors.js';
import type { FlowDefinition, FlowVersion, FlowVersionNumber } from '../types/flow.js';

export function selectFlowDefinition(apiName: string, definitions: ReadonlyArray<FlowDefinition>): FlowDefinition {
  if (definitions.length === 0) {
    throw flowDefinitionNotFound(apiName);
  }
  if (definitions.length > 1) {
    throw flowDefinitionAmbiguous(apiName);
  }
  const definition = definitions[0];
  if (definition === undefined) {
    throw flowQueryFailed(`Salesforce returned an invalid definition result for Flow "${apiName}".`);
  }
  return definition;
}

export function resolveVersionNumber(
  apiName: string,
  versionId: string | null,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionNumber | null {
  if (versionId === null) {
    return null;
  }
  const version = versions.find((item) => item.id === versionId);
  if (version === undefined) {
    throw flowQueryFailed(`Salesforce returned an unknown version for Flow "${apiName}".`);
  }
  return version.versionNumber;
}

export function qualifiedFlowName(apiName: string, namespace: string | null): string {
  return namespace === null ? apiName : `${namespace}__${apiName}`;
}
