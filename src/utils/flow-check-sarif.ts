/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { pathToFileURL } from 'node:url';

import type { FlowCheckFinding } from '../types/flow-check.js';
import { qualifiedFlowName } from './flow-state.js';

interface LogicalFlowSarifLocation {
  logicalLocations: Array<{ name: string; fullyQualifiedName: string; kind: string }>;
  properties: { flowApiName: string; metadataPath?: string };
}

function logicalFlowLocation(item: FlowCheckFinding): LogicalFlowSarifLocation {
  const flowName = qualifiedFlowName(item.apiName, item.namespace);
  return {
    logicalLocations: [
      { name: flowName, fullyQualifiedName: flowName, kind: 'flow' },
      ...(item.path === null
        ? []
        : [
            {
              name: item.path,
              fullyQualifiedName: `${flowName}:${item.path}`,
              kind: 'flowElementOrMetadataPath',
            },
          ]),
    ],
    properties: {
      flowApiName: flowName,
      ...(item.path === null ? {} : { metadataPath: item.path }),
    },
  };
}

export function flowCheckSarifLocations(item: FlowCheckFinding, sourceFile: string | undefined): object[] {
  const flowLocation = logicalFlowLocation(item);
  if (item.locations !== undefined && item.locations.length > 0) {
    return item.locations.map((location) => ({
      ...flowLocation,
      physicalLocation: {
        artifactLocation: { uri: pathToFileURL(location.file).toString() },
        region: {
          startLine: location.startLine,
          startColumn: location.startColumn,
          ...(location.endLine === null ? {} : { endLine: location.endLine }),
          ...(location.endColumn === null ? {} : { endColumn: location.endColumn }),
        },
      },
      properties: { ...flowLocation.properties, primary: location.primary },
    }));
  }
  return [
    {
      ...flowLocation,
      ...(sourceFile === undefined
        ? {}
        : { physicalLocation: { artifactLocation: { uri: pathToFileURL(sourceFile).toString() } } }),
    },
  ];
}
