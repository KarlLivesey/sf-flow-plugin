/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type {
  FlowDocument,
  FlowMetadataLocation,
  FlowResourceEntry,
  FlowResourcesResult,
} from '../types/flow-document.js';
import { jsonObject, metadataLocations } from '../utils/flow-metadata-locations.js';

const RESOURCE_KEYS = ['variables', 'formulas', 'constants', 'textTemplates', 'choices', 'dynamicChoiceSets', 'stages'];

function refersTo(location: FlowMetadataLocation, name: string): boolean {
  if (location.key.endsWith('Reference') || location.key === 'assignToReference') {
    return location.value.split('.')[0] === name;
  }
  if (location.key === 'expression') {
    const code = location.value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gu, '');
    return (code.match(/[A-Za-z_$][A-Za-z0-9_.$]*/gu) ?? []).some((token) => token.split('.')[0] === name);
  }
  return [...location.value.matchAll(/\{!\s*([A-Za-z_$][A-Za-z0-9_.$]*)\s*\}/gu)].some(
    (match) => match[1]?.split('.')[0] === name
  );
}

function resource(definition: JsonObject, kind: string, locations: FlowMetadataLocation[]): FlowResourceEntry[] {
  if (typeof definition.name !== 'string') {
    return [];
  }
  const name = definition.name;
  const ownPath = '$.' + kind + '[name=' + JSON.stringify(name) + ']';
  return [
    {
      name,
      kind,
      definition,
      dataType: typeof definition.dataType === 'string' ? definition.dataType : null,
      usedBy: locations.filter((location) => !location.path.startsWith(ownPath + '.') && refersTo(location, name)),
    },
  ];
}

/** Reference locations exclude the resource's own declaration, but include other resources. */
export function inspectFlowResources(document: FlowDocument): FlowResourcesResult {
  const locations = metadataLocations(document.metadata);
  return {
    flow: document.description.qualifiedName,
    version: document.description.versionNumber,
    resources: RESOURCE_KEYS.flatMap((key) => {
      const values = document.metadata[key];
      return Array.isArray(values) ? values.filter(jsonObject).flatMap((value) => resource(value, key, locations)) : [];
    }).sort((left, right) => left.name.localeCompare(right.name)),
  };
}
