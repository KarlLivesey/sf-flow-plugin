/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { pathToFileURL } from 'node:url';

import type { FlowLintFinding } from '../types/flow-lint.js';

export interface FlowLintSarifLocation {
  logicalLocations?: Array<{
    name: string;
    fullyQualifiedName: string;
    kind: 'flowElement' | 'metadataPath';
  }>;
  properties?: { metadataPath?: string; primary?: boolean };
  physicalLocation?: {
    artifactLocation: { uri: string };
    region?: {
      startLine: number;
      startColumn: number;
      endLine?: number;
      endColumn?: number;
    };
  };
}

export function analyzerFlowLintSarifLocations(flowName: string, finding: FlowLintFinding): FlowLintSarifLocation[] {
  return (finding.locations ?? []).map((location) => ({
    logicalLocations: [
      {
        name: `${location.startLine}:${location.startColumn}`,
        fullyQualifiedName: `${flowName}:${location.startLine}:${location.startColumn}`,
        kind: 'metadataPath',
      },
    ],
    physicalLocation: {
      artifactLocation: { uri: pathToFileURL(location.file).toString() },
      region: {
        startLine: location.startLine,
        startColumn: location.startColumn,
        ...(location.endLine === null ? {} : { endLine: location.endLine }),
        ...(location.endColumn === null ? {} : { endColumn: location.endColumn }),
      },
    },
    properties: { primary: location.primary },
  }));
}
