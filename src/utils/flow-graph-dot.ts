/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowConnectorSummary, FlowDescription, FlowElementSummary } from '../types/flow-inspection.js';
import { dotLegendLines, type DotLegendNode } from './flow-graph-dot-legend.js';
import {
  calledFlow,
  createRenderFlows,
  elementLabel,
  type FlowGraphRenderOptions,
  formulaLabel,
  type RenderFlow,
  variableLabel,
  wrapGraphLabel,
} from './flow-graph-renderer-model.js';
import {
  elementStyleCategory,
  resolveGraphTheme,
  type FlowGraphColorPair,
  type ResolvedFlowGraphTheme,
} from './flow-graph-theme.js';

interface DotNodeOptions {
  colors: FlowGraphColorPair;
  id: string;
  label: string;
  shape: string;
  text: string;
}

interface AnnotationNodeOptions {
  id: string;
  label: string;
  root: string;
}

interface ElementNodeOptions {
  id: string;
  element: FlowElementSummary;
  render: FlowGraphRenderOptions;
  theme: ResolvedFlowGraphTheme;
}

const DOT_ELEMENT_SHAPES: Partial<Record<string, string>> = {
  Start: 'oval',
  Decision: 'diamond',
  Subflow: 'component',
  Screen: 'tab',
  Loop: 'hexagon',
  Wait: 'octagon',
  Action: 'box3d',
  'Apex Plugin': 'box3d',
};

function dotAttributes(attributes: Record<string, number | string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}=${typeof value === 'number' ? String(value) : JSON.stringify(value)}`)
    .join(', ');
}

function dotNode(options: DotNodeOptions): string {
  return `    ${options.id} [${dotAttributes({
    label: options.label,
    shape: options.shape,
    fillcolor: options.colors.fill,
    color: options.colors.stroke,
    fontcolor: options.text,
  })}];`;
}

function elementShape(element: FlowElementSummary): string {
  if (element.type.startsWith('Record ')) {
    return 'cylinder';
  }
  return DOT_ELEMENT_SHAPES[element.type] ?? 'box';
}

function elementNode(options: ElementNodeOptions): string {
  return dotNode({
    id: options.id,
    label: wrapGraphLabel(elementLabel(options.element), options.render.labelWidth, '\n'),
    shape: elementShape(options.element),
    colors: options.theme.node[elementStyleCategory(options.element)],
    text: options.theme.text,
  });
}

function annotationNode(options: AnnotationNodeOptions, theme: ResolvedFlowGraphTheme): string[] {
  return [
    dotNode({
      id: options.id,
      label: options.label,
      shape: 'note',
      colors: theme.resource,
      text: theme.text,
    }),
    `    ${options.root} -> ${options.id} [style="dashed", label="defines"];`,
  ];
}

function dotAnnotations(flow: RenderFlow, options: FlowGraphRenderOptions, theme: ResolvedFlowGraphTheme): string[] {
  const root = flow.elementIds.get('start');
  if (root === undefined) {
    return [];
  }
  const variables = options.includeVariables
    ? flow.description.variables.flatMap((variable, index) =>
        annotationNode(
          {
            id: `f${flow.index}_v${index}`,
            label: wrapGraphLabel(variableLabel(variable), options.labelWidth, '\n'),
            root,
          },
          theme
        )
      )
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) =>
        annotationNode(
          {
            id: `f${flow.index}_x${index}`,
            label: wrapGraphLabel(formulaLabel(formula), options.labelWidth, '\n'),
            root,
          },
          theme
        )
      )
    : [];
  return [...variables, ...formulas];
}

function connectorAttributes(
  connector: FlowConnectorSummary,
  theme: ResolvedFlowGraphTheme,
  labelWidth: number
): Record<string, number | string> {
  const label = connector.label === null ? {} : { label: wrapGraphLabel(connector.label, labelWidth, '\n') };
  if (connector.kind === 'normal') {
    return label;
  }
  return {
    ...label,
    color: theme.connectorKind[connector.kind],
    fontcolor: theme.connectorKind[connector.kind],
    penwidth: connector.kind === 'fault' ? 2.5 : 2,
    ...(connector.kind === 'outcome' ? {} : { style: 'dashed' }),
  };
}

function dotConnectors(flow: RenderFlow, options: FlowGraphRenderOptions, theme: ResolvedFlowGraphTheme): string[] {
  return flow.description.connectors.flatMap((connector) => {
    const source = flow.elementIds.get(connector.source);
    const target = flow.elementIds.get(connector.target);
    if (source === undefined || target === undefined) {
      return [];
    }
    const attributes = connectorAttributes(connector, theme, options.labelWidth);
    const rendered = Object.keys(attributes).length === 0 ? '' : ` [${dotAttributes(attributes)}]`;
    return [`    ${source} -> ${target}${rendered};`];
  });
}

function dotCalls(flow: RenderFlow, flows: ReadonlyArray<RenderFlow>, theme: ResolvedFlowGraphTheme): string[] {
  return flow.description.subflows.flatMap((subflow) => {
    const source = flow.elementIds.get(subflow.name);
    const target = calledFlow(flows, subflow)?.elementIds.get('start');
    return source === undefined || target === undefined
      ? []
      : [
          `  ${source} -> ${target} [${dotAttributes({
            style: 'dashed',
            label: 'calls',
            color: theme.call,
            fontcolor: theme.call,
            penwidth: 2,
          })}];`,
        ];
  });
}

function globalStyleLines(options: FlowGraphRenderOptions, theme: ResolvedFlowGraphTheme): string[] {
  return [
    `  graph [${dotAttributes({
      bgcolor: theme.background,
      compound: 'true',
      fontname: options.style.fontFamily,
      fontsize: options.style.fontSize,
      fontcolor: theme.text,
      pad: 0.3,
      nodesep: 0.45,
      newrank: 'true',
      ranksep: 0.65,
      splines: 'spline',
    })}];`,
    `  node [${dotAttributes({
      style: 'rounded,filled',
      fontname: options.style.fontFamily,
      fontsize: options.style.fontSize,
      fontcolor: theme.text,
      penwidth: 1.5,
      margin: '0.14,0.08',
    })}];`,
    `  edge [${dotAttributes({
      fontname: options.style.fontFamily,
      fontsize: Math.max(8, options.style.fontSize - 2),
      fontcolor: theme.text,
      color: theme.connector,
      penwidth: 1.5,
      arrowsize: 0.75,
    })}];`,
  ];
}

function flowBlock(flow: RenderFlow, options: FlowGraphRenderOptions, theme: ResolvedFlowGraphTheme): string[] {
  const elements = flow.description.elements.map((element) =>
    elementNode({
      id: flow.elementIds.get(element.name) ?? '',
      element,
      render: options,
      theme,
    })
  );
  const cluster = dotAttributes({
    label: `${flow.description.qualifiedName} v${flow.description.versionNumber} · ${flow.description.status}`,
    style: 'rounded,filled',
    fillcolor: theme.cluster.fill,
    color: theme.cluster.stroke,
    fontcolor: theme.text,
    penwidth: 1.5,
  });
  return [
    `  subgraph cluster_f${flow.index} {`,
    `    graph [${cluster}];`,
    ...elements,
    ...dotConnectors(flow, options, theme),
    ...dotAnnotations(flow, options, theme),
    '  }',
  ];
}

export function renderDot(flows: ReadonlyArray<FlowDescription>, options: FlowGraphRenderOptions): string {
  const renderFlows = createRenderFlows(flows);
  const theme = resolveGraphTheme(options.style);
  const lines = [
    'digraph Flow {',
    `  rankdir=${options.direction === 'left-right' ? 'LR' : 'TB'};`,
    ...globalStyleLines(options, theme),
    ...renderFlows.flatMap((flow) => flowBlock(flow, options, theme)),
    ...renderFlows.flatMap((flow) => dotCalls(flow, renderFlows, theme)),
    ...dotLegendLines(options, theme, (node: DotLegendNode) => dotNode({ ...node, text: theme.text })),
    '}',
  ];
  return `${lines.join('\n')}\n`;
}
