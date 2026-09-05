/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { FlowGraphRenderRequest, FlowGraphResult } from '../types/flow-inspection.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import { loadFlowSourceDirectory, traverseLocalSubflows } from './flow-source-directory-service.js';
import { selectDocuments } from './flow-document-service.js';
import { renderDescribedFlowGraph } from './flow-graph-service.js';

export interface LocalGraphSelection {
  directory: string;
  apiName: string;
  namespace: string | undefined;
  recursive: boolean;
  maxDepth: number;
}

export async function graphLocalDirectory(
  selection: LocalGraphSelection,
  request: FlowGraphRenderRequest,
  progress: FlowProgressReporter
): Promise<FlowGraphResult> {
  progress('loading-source', selection.directory);
  const directory = await loadFlowSourceDirectory(selection.directory);
  const root = selectDocuments(directory.sources, { apiNames: [selection.apiName], namespace: selection.namespace })[0];
  if (root === undefined) {
    throw flowInspectionFailed('The requested root Flow was not found in the source directory.');
  }
  const traversal = selection.recursive
    ? traverseLocalSubflows(root, directory.sources, selection.maxDepth)
    : { sources: [{ source: root, depth: 0 }], warnings: [] };
  return renderDescribedFlowGraph(
    {
      apiName: root.apiName,
      namespace: root.namespace,
      requestedVersion: null,
      resolvedVersion: null,
      subflowVersion: 'active',
      recursive: selection.recursive,
      maxDepth: selection.maxDepth,
      flows: traversal.sources.map(({ source, depth }) => ({ ...source.description, depth })),
      warnings: traversal.warnings,
      targetOrg: null,
      sourceFile: root.sourceFile,
      sourceDirectory: directory.directory,
    },
    request,
    progress
  );
}
