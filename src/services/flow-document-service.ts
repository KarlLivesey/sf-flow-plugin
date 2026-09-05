/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { FlowComparisonVersionSelector, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowVersion } from '../types/flow.js';
import type { FlowDocument } from '../types/flow-document.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { boundedMap } from '../utils/bounded-map.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { validateFlowApiName, validateNamespace } from '../utils/flow-name-validation.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';

export interface DocumentSelection {
  allowMissing?: boolean;
  apiNames: string[];
  namespace?: string | undefined;
  version: FlowComparisonVersionSelector;
  targetOrg: string;
}

function validateSelectionName(name: string): void {
  const separator = name.indexOf('__');
  if (separator >= 0) {
    validateNamespace(name.slice(0, separator));
    validateFlowApiName(name.slice(separator + 2));
  } else {
    validateFlowApiName(name);
  }
}

export function selectDocuments<T extends { apiName: string; namespace: string | null }>(
  definitions: ReadonlyArray<T>,
  selection: Pick<DocumentSelection, 'apiNames' | 'namespace' | 'allowMissing'>
): T[] {
  selection.apiNames.forEach((name) => {
    validateSelectionName(name);
  });
  if (selection.namespace !== undefined) {
    validateNamespace(selection.namespace);
  }
  const scoped = definitions.filter(
    (item) => selection.namespace === undefined || item.namespace === selection.namespace
  );
  selection.apiNames.forEach((name) => {
    const matches = scoped.filter(
      (item) => item.apiName === name || qualifiedFlowName(item.apiName, item.namespace) === name
    );
    if (matches.length > 1 || (matches.length === 0 && selection.allowMissing !== true)) {
      throw flowInspectionFailed(
        'Flow "' + name + '" is missing or ambiguous; specify its qualified name or namespace.'
      );
    }
  });
  return scoped
    .filter(
      (item) =>
        selection.apiNames.length === 0 ||
        selection.apiNames.some(
          (name) => name === item.apiName || name === qualifiedFlowName(item.apiName, item.namespace)
        )
    )
    .sort((left, right) =>
      qualifiedFlowName(left.apiName, left.namespace).localeCompare(qualifiedFlowName(right.apiName, right.namespace))
    );
}

function selectedVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  selector: FlowComparisonVersionSelector
): FlowVersion {
  const id = selector === 'active' ? definition.activeVersionId : definition.latestVersionId;
  const version = versions.find(
    (item) =>
      item.definitionId === definition.id &&
      (typeof selector === 'number' ? item.versionNumber === selector : item.id === id)
  );
  if (version === undefined) {
    throw flowInspectionFailed(
      'Flow "' +
        qualifiedFlowName(definition.apiName, definition.namespace) +
        '" has no ' +
        String(selector) +
        ' version.'
    );
  }
  return version;
}

/** Bulk inventory reads, bounded metadata downloads, and no silent omission of selected versions. */
export async function loadOrgDocuments(
  gateway: FlowDefinitionGateway & FlowMetadataGateway,
  request: DocumentSelection,
  progress: FlowProgressReporter = noFlowProgress
): Promise<FlowDocument[]> {
  progress('loading-flows', 'Flow definitions for metadata inspection');
  const definitions = selectDocuments(await gateway.findAllDefinitions(), request);
  const versions = await gateway.findAllVersions();
  return boundedMap(definitions, 4, async (definition) => {
    const version = selectedVersion(definition, versions, request.version);
    progress(
      'loading-metadata',
      qualifiedFlowName(definition.apiName, definition.namespace) + ' v' + String(version.versionNumber)
    );
    const metadata = await gateway.getVersionMetadata(version.id);
    return {
      metadata,
      description: analyseFlowMetadata({ definition, version, metadata, depth: 0 }),
      sourceFile: null,
      targetOrg: request.targetOrg,
    };
  });
}
