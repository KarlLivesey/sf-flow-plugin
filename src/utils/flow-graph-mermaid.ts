/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type {
  FlowConnectorSummary,
  FlowDescription,
  FlowElementSummary,
  FlowGraphStyle,
} from '../types/flow-inspection.js';
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
  type FlowGraphStyleCategory,
  type ResolvedFlowGraphTheme,
} from './flow-graph-theme.js';

const NODE_CATEGORIES = ['node', 'start', 'decision', 'subflow', 'action', 'record', 'screen'] as const;

interface MermaidConnector {
  kind: FlowConnectorSummary['kind'];
  line: string;
}

interface MermaidFlowBlock {
  connectorKinds: Array<FlowConnectorSummary['kind']>;
  edgeCount: number;
  lines: string[];
}

const MERMAID_NODE_DELIMITERS: Partial<Record<string, readonly [string, string]>> = {
  Start: ['(["', '"])'],
  Decision: ['{"', '"}'],
  Subflow: ['[["', '"]]'],
  Record: ['[("', '")]'],
  Screen: ['[/"', '"/]'],
  Loop: ['{{"', '"}}'],
  Action: ['("', '")'],
  'Apex Plugin': ['("', '")'],
  Wait: ['(["', '"])'],
};

function mermaidText(value: string): string {
  return value.replaceAll('"', '&quot;').replaceAll('\n', ' ');
}

function mermaidClass(category: FlowGraphStyleCategory | 'resource'): string {
  return `flow${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

function mermaidLabel(value: string, width: number): string {
  return wrapGraphLabel(mermaidText(value), width, '<br/>');
}

function mermaidNode(id: string, element: FlowElementSummary, labelWidth: number): string {
  const label = mermaidLabel(elementLabel(element), labelWidth);
  const category = elementStyleCategory(element);
  const shape = category === 'record' ? 'Record' : element.type;
  const [opening, closing] = MERMAID_NODE_DELIMITERS[shape] ?? ['["', '"]'];
  return `    ${id}${opening}${label}${closing}:::${mermaidClass(category)}`;
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
          `    ${id}[/"${mermaidLabel(variableLabel(variable), options.labelWidth)}"/]:::flowResource`,
          `    ${root} -. defines .-> ${id}`,
        ];
      })
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) => {
        const id = `f${flow.index}_x${index}`;
        return [
          `    ${id}["${mermaidLabel(formulaLabel(formula), options.labelWidth)}"]:::flowResource`,
          `    ${root} -. defines .-> ${id}`,
        ];
      })
    : [];
  return [...variables, ...formulas];
}

function mermaidConnectors(flow: RenderFlow, labelWidth: number): MermaidConnector[] {
  return flow.description.connectors.flatMap((connector) => {
    const source = flow.elementIds.get(connector.source);
    const target = flow.elementIds.get(connector.target);
    if (source === undefined || target === undefined) {
      return [];
    }
    const label = connector.label === null ? '' : `|"${mermaidLabel(connector.label, labelWidth)}"|`;
    return [{ kind: connector.kind, line: `    ${source} -->${label} ${target}` }];
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
    flowchart: {
      curve: 'basis',
      htmlLabels: true,
      nodeSpacing: 35,
      padding: 15,
      rankSpacing: 45,
    },
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

function flowBlock(flow: RenderFlow, options: FlowGraphRenderOptions): MermaidFlowBlock {
  const connectors = mermaidConnectors(flow, options.labelWidth);
  const annotations = mermaidAnnotations(flow, options);
  const label = mermaidText(
    `${flow.description.qualifiedName} v${flow.description.versionNumber} · ${flow.description.status}`
  );
  const elements = flow.description.elements.map((element) =>
    mermaidNode(flow.elementIds.get(element.name) ?? '', element, options.labelWidth)
  );
  return {
    connectorKinds: connectors.map((connector) => connector.kind),
    edgeCount: connectors.length + annotations.length / 2,
    lines: [
      `  subgraph f${flow.index}["${label}"]`,
      `    direction ${options.direction === 'left-right' ? 'LR' : 'TB'}`,
      ...elements,
      ...connectors.map((connector) => connector.line),
      ...annotations,
      '  end',
    ],
  };
}

function legendLines(options: FlowGraphRenderOptions): string[] {
  if (!options.legend) {
    return [];
  }
  return [
    '  subgraph flowLegend["Legend"]',
    '    direction LR',
    '    legendStart(["Start"]):::flowStart',
    '    legendDecision{"Decision"}:::flowDecision',
    '    legendSubflow[["Subflow"]]:::flowSubflow',
    '    legendOutcome["Outcome path"]:::flowLegendOutcome',
    '    legendDefault["Default path"]:::flowLegendDefault',
    '    legendFault["Fault path"]:::flowLegendFault',
    '  end',
  ];
}

function styleLines(
  flows: ReadonlyArray<RenderFlow>,
  options: FlowGraphRenderOptions,
  theme: ResolvedFlowGraphTheme
): string[] {
  const clusters = flows.map(
    (flow) =>
      `  style f${flow.index} fill:${theme.cluster.fill},stroke:${theme.cluster.stroke},color:${theme.text},stroke-width:1.5px;`
  );
  const classes = NODE_CATEGORIES.map((category) => classDefinition(category, theme.node[category], theme.text));
  return [
    ...clusters,
    ...classes,
    classDefinition('resource', theme.resource, theme.text),
    `  classDef flowLegendOutcome fill:${theme.background},stroke:${theme.connectorKind.outcome},color:${theme.connectorKind.outcome},stroke-width:2px;`,
    `  classDef flowLegendDefault fill:${theme.background},stroke:${theme.connectorKind.default},color:${theme.connectorKind.default},stroke-width:2px,stroke-dasharray:5 3;`,
    `  classDef flowLegendFault fill:${theme.background},stroke:${theme.connectorKind.fault},color:${theme.connectorKind.fault},stroke-width:2px,stroke-dasharray:5 3;`,
    ...(options.legend
      ? [
          `  style flowLegend fill:${theme.cluster.fill},stroke:${theme.cluster.stroke},color:${theme.text},stroke-width:1px;`,
        ]
      : []),
    `  linkStyle default stroke:${theme.connector},stroke-width:1.5px;`,
  ];
}

function connectorStyleLines(blocks: ReadonlyArray<MermaidFlowBlock>, theme: ResolvedFlowGraphTheme): string[] {
  const indexes = new Map<FlowConnectorSummary['kind'], number[]>();
  let offset = 0;
  for (const block of blocks) {
    block.connectorKinds.forEach((kind, index) => indexes.set(kind, [...(indexes.get(kind) ?? []), offset + index]));
    offset += block.edgeCount;
  }
  return (['outcome', 'default', 'fault'] as const).flatMap((kind) => {
    const selected = indexes.get(kind) ?? [];
    const dashed = kind === 'outcome' ? '' : ',stroke-dasharray:5 3';
    return selected.length === 0
      ? []
      : [
          `  linkStyle ${selected.join(',')} stroke:${theme.connectorKind[kind]},stroke-width:${
            kind === 'fault' ? 2.5 : 2
          }px${dashed};`,
        ];
  });
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
    `flowchart ${options.direction === 'left-right' ? 'LR' : 'TD'}`,
    ...blocks.flatMap((block) => block.lines),
    ...calls,
    ...legendLines(options),
    ...styleLines(renderFlows, options, theme),
    ...connectorStyleLines(blocks, theme),
    ...callStyle(calls, bodyEdgeCount, theme),
  ];
  return `${lines.join('\n')}\n`;
}
