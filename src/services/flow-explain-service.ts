/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { FlowDocument, FlowExplainResult } from '../types/flow-document.js';
import { metadataLocations } from '../utils/flow-metadata-locations.js';
import { inspectFlowResources } from './flow-resources-service.js';

/** Describe the selected element's stored configuration; do not simulate conditions or execution. */
export function explainFlowElement(document: FlowDocument, name: string): FlowExplainResult {
  const element = document.description.elements.find((candidate) => candidate.name === name);
  if (element === undefined) {
    throw flowInspectionFailed('Element "' + name + '" was not found in ' + document.description.qualifiedName + '.');
  }
  const details = metadataLocations(document.metadata).filter(
    (location) => location.element === name && !['locationX', 'locationY', 'name', 'label'].includes(location.key)
  );
  return {
    flow: document.description.qualifiedName,
    version: document.description.versionNumber,
    element: name,
    type: element.type,
    label: element.label,
    details,
    references: inspectFlowResources(document).resources.flatMap((resource) =>
      resource.usedBy.filter((location) => location.element === name)
    ),
    outgoing: document.description.connectors
      .filter((connector) => connector.source === name)
      .map(({ target, kind, label }) => ({ target, kind, label })),
  };
}
