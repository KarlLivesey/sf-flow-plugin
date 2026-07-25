/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDescription, FlowElementSummary, FlowGraphStyle } from '../types/flow-inspection.js';
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
  type FlowGraphStyleCategory,
  type ResolvedFlowGraphTheme,
} from './flow-graph-theme.js';

const NODE_CATEGORIES = ['node', 'start', 'decision', 'subflow', 'action', 'record', 'screen'] as const;

function mermaidText(value: string): string {
  return value.replaceAll('"', '&quot;').replaceAll('\n', ' ');
}

function mermaidClass(category: FlowGraphStyleCategory | 'resource'): string {
  return `flow${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

function mermaidNode(id: string, element: FlowElementSummary): string {
  const label = mermaidText(elementLabel(element));
  if (element.type === 'Start') {
    return `    ${id}(["${label}"]):::flowStart`;
  }
  if (element.type === 'Decision') {
    return `    ${id}{"${label}"}:::flowDecision`;
  }
  if (element.type === 'Subflow') {
    return `    ${id}[["${label}"]]:::flowSubflow`;
  }
  return `    ${id}["${label}"]:::${mermaidClass(elementStyleCategory(element))}`;
}

function mermaidAnnotations(flow: RenderFlow, options: FlowGraphRenderOptions): string[] {
  const root = flow.elementIds.get('start');
  if (root === undefined) {
    return [];
  }
  const variables = options.includeVariables
    ? flow.description.variables.flatMap((variable, index) => {
        const id = `f${flow.index}_v${index}`;
        return [
          `    ${id}[/"${mermaidText(variableLabel(variable))}"/]:::flowResource`,
          `    ${root} -. defines .-> ${id}`,
        ];
      })
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) => {
        const id = `f${flow.index}_x${index}`;
        return [
          `    ${id}["${mermaidText(formulaLabel(formula))}"]:::flowResource`,
          `    ${root} -. defines .-> ${id}`,
        ];
      })
    : [];
  return [...variables, ...formulas];
}

function mermaidConnectors(flow: RenderFlow): string[] {
  return flow.description.connectors.flatMap((connector) => {
    const source = flow.elementIds.get(connector.source);
    const target = flow.elementIds.get(connector.target);
    if (source === undefined || target === undefined) {
      return [];
    }
    const label = connector.label === null ? '' : `|"${mermaidText(connector.label)}"|`;
    return [`    ${source} -->${label} ${target}`];
  });
}

function mermaidCalls(flow: RenderFlow, flows: ReadonlyArray<RenderFlow>): string[] {
  return flow.description.subflows.flatMap((subflow) => {
    const source = flow.elementIds.get(subflow.name);
    const target = calledFlow(flows, subflow)?.elementIds.get('start');
    return source === undefined || target === undefined ? [] : [`  ${source} -. "calls" .-> ${target}`];
  });
}

function classDefinition(
  category: FlowGraphStyleCategory | 'resource',
  colors: FlowGraphColorPair,
  text: string
): string {
  return `  classDef ${mermaidClass(category)} fill:${colors.fill},stroke:${
    colors.stroke
  },color:${text},stroke-width:1.5px;`;
}

function mermaidHeader(style: FlowGraphStyle, theme: ResolvedFlowGraphTheme): string {
  return `%%{init: ${JSON.stringify({
    theme: 'base',
    themeVariables: {
      background: theme.background,
      fontFamily: style.fontFamily,
      fontSize: `${style.fontSize}px`,
      lineColor: theme.connector,
      primaryTextColor: theme.text,
      textColor: theme.text,
    },
  })}}%%`;
}

function flowBlock(flow: RenderFlow, options: FlowGraphRenderOptions): { edgeCount: number; lines: string[] } {
  const connectors = mermaidConnectors(flow);
  const annotations = mermaidAnnotations(flow, options);
  const label = mermaidText(`${flow.description.qualifiedName} v${flow.description.versionNumber}`);
  const elements = flow.description.elements.map((element) =>
    mermaidNode(flow.elementIds.get(element.name) ?? '', element)
  );
  return {
    edgeCount: connectors.length + annotations.length / 2,
    lines: [`  subgraph f${flow.index}["${label}"]`, ...elements, ...connectors, ...annotations, '  end'],
  };
}

function styleLines(flows: ReadonlyArray<RenderFlow>, theme: ResolvedFlowGraphTheme): string[] {
  const clusters = flows.map(
    (flow) =>
      `  style f${flow.index} fill:${theme.cluster.fill},stroke:${theme.cluster.stroke},color:${theme.text},stroke-width:1.5px;`
  );
  const classes = NODE_CATEGORIES.map((category) => classDefinition(category, theme.node[category], theme.text));
  return [
    ...clusters,
    ...classes,
    classDefinition('resource', theme.resource, theme.text),
    `  linkStyle default stroke:${theme.connector},stroke-width:1.5px;`,
  ];
}

function callStyle(calls: ReadonlyArray<string>, bodyEdgeCount: number, theme: ResolvedFlowGraphTheme): string[] {
  const indexes = calls.map((_, index) => bodyEdgeCount + index).join(',');
  return calls.length === 0 ? [] : [`  linkStyle ${indexes} stroke:${theme.call},stroke-width:2px;`];
}

export function renderMermaid(flows: ReadonlyArray<FlowDescription>, options: FlowGraphRenderOptions): string {
  const renderFlows = createRenderFlows(flows);
  const theme = resolveGraphTheme(options.style);
  const blocks = renderFlows.map((flow) => flowBlock(flow, options));
  const bodyEdgeCount = blocks.reduce((total, block) => total + block.edgeCount, 0);
  const calls = renderFlows.flatMap((flow) => mermaidCalls(flow, renderFlows));
  const lines = [
    mermaidHeader(options.style, theme),
    'flowchart TD',
    ...blocks.flatMap((block) => block.lines),
    ...calls,
    ...styleLines(renderFlows, theme),
    ...callStyle(calls, bodyEdgeCount, theme),
  ];
  return `${lines.join('\n')}\n`;
}
