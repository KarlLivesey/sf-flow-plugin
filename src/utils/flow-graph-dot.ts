/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDescription, FlowElementSummary } from '../types/flow-inspection.js';
import {
  calledFlow,
  createRenderFlows,
  elementLabel,
  type FlowGraphRenderOptions,
  formulaLabel,
  type RenderFlow,
  variableLabel,
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
  if (element.type === 'Start') {
    return 'oval';
  }
  if (element.type === 'Decision') {
    return 'diamond';
  }
  if (element.type === 'Subflow') {
    return 'component';
  }
  return element.type === 'Screen' ? 'tab' : 'box';
}

function elementNode(id: string, element: FlowElementSummary, theme: ResolvedFlowGraphTheme): string {
  return dotNode({
    id,
    label: elementLabel(element),
    shape: elementShape(element),
    colors: theme.node[elementStyleCategory(element)],
    text: theme.text,
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
        annotationNode({ id: `f${flow.index}_v${index}`, label: variableLabel(variable), root }, theme)
      )
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) =>
        annotationNode({ id: `f${flow.index}_x${index}`, label: formulaLabel(formula), root }, theme)
      )
    : [];
  return [...variables, ...formulas];
}

function dotConnectors(flow: RenderFlow): string[] {
  return flow.description.connectors.flatMap((connector) => {
    const source = flow.elementIds.get(connector.source);
    const target = flow.elementIds.get(connector.target);
    if (source === undefined || target === undefined) {
      return [];
    }
    const label = connector.label === null ? '' : ` [label=${JSON.stringify(connector.label)}]`;
    return [`    ${source} -> ${target}${label};`];
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
      fontname: options.style.fontFamily,
      fontsize: options.style.fontSize,
      fontcolor: theme.text,
      pad: 0.3,
      nodesep: 0.45,
      ranksep: 0.65,
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
    elementNode(flow.elementIds.get(element.name) ?? '', element, theme)
  );
  const cluster = dotAttributes({
    label: `${flow.description.qualifiedName} v${flow.description.versionNumber}`,
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
    ...dotConnectors(flow),
    ...dotAnnotations(flow, options, theme),
    '  }',
  ];
}

export function renderDot(flows: ReadonlyArray<FlowDescription>, options: FlowGraphRenderOptions): string {
  const renderFlows = createRenderFlows(flows);
  const theme = resolveGraphTheme(options.style);
  const lines = [
    'digraph Flow {',
    '  rankdir=TB;',
    ...globalStyleLines(options, theme),
    ...renderFlows.flatMap((flow) => flowBlock(flow, options, theme)),
    ...renderFlows.flatMap((flow) => dotCalls(flow, renderFlows, theme)),
    '}',
  ];
  return `${lines.join('\n')}\n`;
}
