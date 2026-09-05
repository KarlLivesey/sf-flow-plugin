/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { GraphFlagValues } from '../commands/flow/graph.js';
import type { FlowGraphResult } from '../types/flow-inspection.js';
import type { FlowDocument } from '../types/flow-document.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import { createSourceGraphRequest } from '../utils/flow-graph-command.js';
import { createFlowCommandContext } from '../utils/flow-command.js';
import { changedGraphRoot } from '../utils/flow-graph-changes.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import { loadFlowSource } from './flow-source-service.js';
import { loadOrgDocuments } from './flow-document-service.js';
import { ToolingFlowDefinitionGateway } from './tooling-flow-definition-gateway.js';
import { renderDescribedFlowGraph } from './flow-graph-service.js';

async function localDocument(file: string): Promise<FlowDocument> {
  const source = await loadFlowSource(file);
  return { metadata: source.metadata, description: source.description, sourceFile: source.sourceFile, targetOrg: null };
}

async function comparisonDocuments(
  flags: GraphFlagValues,
  result: FlowGraphResult,
  progress: FlowProgressReporter
): Promise<{ before: FlowDocument; after: FlowDocument }> {
  if (result.sourceFile !== undefined) {
    if (flags['from-file'] === undefined) {
      throw flowInspectionFailed('Local graph highlighting requires --from-file.');
    }
    return { before: await localDocument(flags['from-file']), after: await localDocument(result.sourceFile) };
  }
  return orgComparisonDocuments(flags, result, progress);
}

async function orgComparisonDocuments(
  flags: GraphFlagValues,
  result: FlowGraphResult,
  progress: FlowProgressReporter
): Promise<{ before: FlowDocument; after: FlowDocument }> {
  const context = createFlowCommandContext(flags);
  const gateway = new ToolingFlowDefinitionGateway(context.connection);
  const selection = {
    apiNames: [result.apiName],
    namespace: result.namespace ?? undefined,
    targetOrg: context.targetOrg,
  };
  const before = await loadOrgDocuments(gateway, { ...selection, version: flags.from ?? 'active' }, progress);
  const after = await loadOrgDocuments(
    gateway,
    { ...selection, version: result.resolvedVersion ?? flags['flow-version'] },
    progress
  );
  if (before[0] === undefined || after[0] === undefined) {
    throw flowInspectionFailed('Graph comparison could not resolve both versions.');
  }
  return { before: before[0], after: after[0] };
}

/** Highlight root changes only; recursively expanded child Flows keep their selected versions. */
export async function highlightFlowGraph(
  flags: GraphFlagValues,
  result: FlowGraphResult,
  progress: FlowProgressReporter
): Promise<FlowGraphResult> {
  if (flags['highlight-changes'] !== true) {
    return result;
  }
  const { before, after } = await comparisonDocuments(flags, result, progress);
  const changes = changedGraphRoot(before, after);
  return renderDescribedFlowGraph(
    {
      ...result,
      flows: result.flows.map((flow) => (flow.qualifiedName === changes.flow.qualifiedName ? changes.flow : flow)),
    },
    { ...createSourceGraphRequest(flags), highlights: changes.highlights },
    progress
  );
}
