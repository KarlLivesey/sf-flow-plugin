/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from './flow-analysis.js';
import type { FlowDescription } from './flow-inspection.js';

export interface FlowDocument {
  metadata: JsonObject;
  description: FlowDescription;
  sourceFile: string | null;
  targetOrg: string | null;
}

export interface FlowMetadataLocation {
  path: string;
  element: string | null;
  key: string;
  value: string;
}

export interface FlowSearchMatch extends FlowMetadataLocation {
  flow: string;
  version: number | null;
}

export interface FlowSearchResult {
  query: string;
  kind: string;
  flowsScanned: number;
  matches: FlowSearchMatch[];
}

export interface FlowResourceEntry {
  name: string;
  kind: string;
  dataType: string | null;
  definition: JsonObject;
  usedBy: FlowMetadataLocation[];
}

export interface FlowResourcesResult {
  flow: string;
  version: number | null;
  resources: FlowResourceEntry[];
}

export interface FlowExplainResult {
  flow: string;
  version: number | null;
  element: string;
  type: string;
  label: string | null;
  details: FlowMetadataLocation[];
  references: FlowMetadataLocation[];
  outgoing: Array<{ target: string; kind: string; label: string | null }>;
}
