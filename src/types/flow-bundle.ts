/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonVersionSelector, FlowDependency } from './flow-analysis.js';
import type { NamedFlowRequest } from './flow.js';
import type { FlowExportStatus, FlowSubflowVersionSelector, FlowTraversalWarning } from './flow-inspection.js';

export interface FlowBundleRequest extends NamedFlowRequest {
  version: FlowComparisonVersionSelector;
  subflowVersion: FlowSubflowVersionSelector;
  maxDepth: number;
  status: FlowExportStatus;
  outputDir: string;
  overwrite: boolean;
}

export interface FlowBundleVersion {
  apiName: string;
  namespace: string | null;
  qualifiedName: string;
  definitionId: string;
  versionId: string;
  versionNumber: number;
  sourceStatus: string;
  exportedStatus: 'Active' | 'Draft';
  file: string;
}

export interface FlowBundleExternalDependency {
  name: string;
  namespace: string | null;
  type: string;
}

export interface FlowBundleFile {
  path: string;
  content: string;
}

export interface FlowBundleResult {
  apiName: string;
  namespace: string | null;
  requestedVersion: FlowComparisonVersionSelector;
  resolvedVersion: number;
  subflowVersion: FlowSubflowVersionSelector;
  maxDepth: number;
  exportedStatus: 'Active' | 'Draft';
  outputDir: string;
  overwrite: boolean;
  flows: FlowBundleVersion[];
  dependencies: FlowDependency[];
  externalDependencies: FlowBundleExternalDependency[];
  warnings: FlowTraversalWarning[];
  outputFiles: string[];
  targetOrg: string;
}

export interface FlowBundleArtifact {
  result: FlowBundleResult;
  files: FlowBundleFile[];
}
