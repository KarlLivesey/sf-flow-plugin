/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonChangeKind, JsonObject } from '../types/flow-analysis.js';
import type { FlowDescription, FlowGraphFormat, FlowGraphHighlight } from '../types/flow-inspection.js';
import type { FlowDocument } from '../types/flow-document.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import { compareFlowMetadata } from './flow-metadata-diff.js';
import { jsonObject } from './flow-metadata-locations.js';
import { createRenderFlows } from './flow-graph-renderer-model.js';

function elementMetadata(metadata: JsonObject, name: string): JsonObject {
  if (name === 'start') {
    return jsonObject(metadata.start) ? metadata.start : {};
  }
  const match = Object.values(metadata)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .find((value) => jsonObject(value) && value.name === name);
  return jsonObject(match) ? match : {};
}

function changeKind(name: string, before: FlowDocument, after: FlowDocument): FlowComparisonChangeKind | undefined {
  const old = before.description.elements.find((element) => element.name === name);
  const current = after.description.elements.find((element) => element.name === name);
  if (old === undefined || current === undefined) {
    return old === undefined ? 'added' : 'removed';
  }
  const differences = compareFlowMetadata(
    elementMetadata(before.metadata, name),
    elementMetadata(after.metadata, name)
  );
  return old.type !== current.type || differences.length > 0 ? 'changed' : undefined;
}

/** Preserve removed nodes and their original edges in a clearly labelled comparison overlay. */
export function changedGraphRoot(
  before: FlowDocument,
  after: FlowDocument
): { flow: FlowDescription; highlights: FlowGraphHighlight[] } {
  if (before.description.qualifiedName !== after.description.qualifiedName) {
    throw flowInspectionFailed('Graph comparison requires the same qualified Flow identity.');
  }
  const names = [
    ...new Set([...before.description.elements, ...after.description.elements].map((element) => element.name)),
  ];
  const highlights = names.flatMap((element) => {
    const kind = changeKind(element, before, after);
    return kind === undefined ? [] : [{ flow: after.description.qualifiedName, element, kind }];
  });
  const removed = new Set(highlights.filter((change) => change.kind === 'removed').map((change) => change.element));
  const elements = [
    ...after.description.elements,
    ...before.description.elements.filter((element) => removed.has(element.name)),
  ];
  return {
    highlights,
    flow: {
      ...after.description,
      elements: elements.map((element) => {
        const kind = highlights.find((change) => change.element === element.name)?.kind;
        return kind === undefined
          ? element
          : { ...element, label: '[' + kind + '] ' + (element.label ?? element.name) };
      }),
      connectors: [
        ...after.description.connectors,
        ...before.description.connectors
          .filter((connector) => removed.has(connector.source) || removed.has(connector.target))
          .map((connector) => ({ ...connector, label: '[removed] ' + (connector.label ?? '') })),
      ],
    },
  };
}

const CHANGE_COLORS = { added: '#15803d', removed: '#b91c1c', changed: '#b45309' };

export function styleGraphChanges(
  graph: string,
  context: { flows: ReadonlyArray<FlowDescription>; highlights: ReadonlyArray<FlowGraphHighlight> },
  format: FlowGraphFormat
): string {
  const flows = createRenderFlows(context.flows);
  const styles = context.highlights.flatMap((change) => {
    const flow = flows.find((item) => item.description.qualifiedName === change.flow);
    const id = flow?.elementIds.get(change.element);
    if (id === undefined) {
      return [];
    }
    const color = CHANGE_COLORS[change.kind];
    return [
      format === 'mermaid'
        ? '  style ' + id + ' stroke:' + color + ',stroke-width:4px;'
        : '  ' + id + ' [color="' + color + '", penwidth=4];',
    ];
  });
  return format === 'mermaid'
    ? graph + styles.join('\n') + '\n'
    : graph.replace(/\}\s*$/u, styles.join('\n') + '\n}\n');
}
