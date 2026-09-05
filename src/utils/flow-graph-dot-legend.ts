/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowGraphRenderOptions } from './flow-graph-renderer-model.js';
import type { FlowGraphColorPair, ResolvedFlowGraphTheme } from './flow-graph-theme.js';

export interface DotLegendNode {
  colors: FlowGraphColorPair;
  id: string;
  label: string;
  shape: string;
}

type DotLegendNodeRenderer = (node: DotLegendNode) => string;

function legendNodes(theme: ResolvedFlowGraphTheme, renderNode: DotLegendNodeRenderer): string[] {
  const connectorColors = (stroke: string): FlowGraphColorPair => ({ fill: theme.background, stroke });
  return [
    renderNode({ id: 'legend_start', label: 'Start', shape: 'oval', colors: theme.node.start }),
    renderNode({ id: 'legend_decision', label: 'Decision', shape: 'diamond', colors: theme.node.decision }),
    renderNode({ id: 'legend_subflow', label: 'Subflow', shape: 'component', colors: theme.node.subflow }),
    renderNode({
      id: 'legend_outcome',
      label: 'Outcome path',
      shape: 'box',
      colors: connectorColors(theme.connectorKind.outcome),
    }),
    renderNode({
      id: 'legend_default',
      label: 'Default path',
      shape: 'box',
      colors: connectorColors(theme.connectorKind.default),
    }),
    renderNode({
      id: 'legend_fault',
      label: 'Fault path',
      shape: 'box',
      colors: connectorColors(theme.connectorKind.fault),
    }),
  ];
}

export function dotLegendLines(
  options: FlowGraphRenderOptions,
  theme: ResolvedFlowGraphTheme,
  renderNode: DotLegendNodeRenderer
): string[] {
  if (!options.legend) {
    return [];
  }
  return [
    '  subgraph cluster_legend {',
    `    graph [label="Legend", style="rounded,filled", fillcolor="${theme.cluster.fill}", color="${theme.cluster.stroke}", fontcolor="${theme.text}"];`,
    ...legendNodes(theme, renderNode),
    '  }',
  ];
}
