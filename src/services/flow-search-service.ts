/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDocument, FlowSearchResult, FlowMetadataLocation } from '../types/flow-document.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import { metadataLocations } from '../utils/flow-metadata-locations.js';

export type FlowSearchKind = 'text' | 'object' | 'field' | 'apex' | 'subflow';
const FIELD_PROPERTIES = new Set([
  'field',
  'queriedFields',
  'sortField',
  'recordField',
  'displayField',
  'picklistField',
  'valueField',
  'fieldReference',
  'elementReference',
  'leftValueReference',
  'assignToReference',
  'assignNextValueToReference',
  'assignRecordIdToReference',
  'collectionReference',
  'inputReference',
  'outputReference',
]);

function matchesKind(location: FlowMetadataLocation, kind: FlowSearchKind, document: FlowDocument): boolean {
  switch (kind) {
    case 'text':
      return true;
    case 'object':
      return ['object', 'objectType'].includes(location.key);
    case 'field':
      return FIELD_PROPERTIES.has(location.key);
    case 'apex':
      return (
        location.key === 'apexClass' ||
        (location.key === 'actionName' &&
          document.description.apexActions.some((action) => action.name === location.element))
      );
    case 'subflow':
      return location.key === 'flowName';
  }
}

/** Literal substring search (not regex). Component kinds select explicit metadata fields. */
export function searchFlowDocuments(
  documents: ReadonlyArray<FlowDocument>,
  query: string,
  options: { kind: FlowSearchKind; caseSensitive: boolean }
): FlowSearchResult {
  if (query.trim().length === 0) {
    throw flowInspectionFailed('A non-empty literal search query is required.');
  }
  const normalise = (value: string): string => (options.caseSensitive ? value : value.toLowerCase());
  return {
    query,
    kind: options.kind,
    flowsScanned: documents.length,
    matches: documents.flatMap((document) =>
      metadataLocations(document.metadata)
        .filter(
          (location) =>
            matchesKind(location, options.kind, document) && normalise(location.value).includes(normalise(query))
        )
        .map((location) => ({
          ...location,
          flow: document.description.qualifiedName,
          version: document.description.versionNumber,
        }))
    ),
  };
}
