/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type {
  FlowDescription,
  FlowElementSummary,
  FlowFormulaSummary,
  FlowGraphFormat,
  FlowSubflowSummary,
  FlowVariableSummary,
} from '../types/flow-inspection.js';

interface GraphOptions {
  includeVariables: boolean;
  includeFormulas: boolean;
}

interface RenderFlow {
  description: FlowDescription;
  index: number;
  elementIds: Map<string, string>;
}

function createRenderFlows(flows: ReadonlyArray<FlowDescription>): RenderFlow[] {
  return flows.map((description, index) => ({
    description,
    index,
    elementIds: new Map(
      description.elements.map((element, elementIndex) => [element.name, `f${index}_e${elementIndex}`])
    ),
  }));
}

function elementLabel(element: FlowElementSummary): string {
  const name = element.label ?? element.name;
  return `${element.type}: ${name}`;
}

function mermaidText(value: string): string {
  return value.replaceAll('"', '&quot;').replaceAll('\n', ' ');
}

function mermaidNode(id: string, element: FlowElementSummary): string {
  const label = mermaidText(elementLabel(element));
  if (element.type === 'Start') {
    return `    ${id}(["${label}"])`;
  }
  if (element.type === 'Decision') {
    return `    ${id}{"${label}"}`;
  }
  return `    ${id}["${label}"]`;
}

function variableLabel(variable: FlowVariableSummary): string {
  const modes = [variable.input ? 'input' : '', variable.output ? 'output' : ''].filter(Boolean).join(', ');
  const type = variable.objectType ?? variable.apexClass ?? variable.dataType;
  return `Variable: ${variable.name} (${type}${modes.length > 0 ? `; ${modes}` : ''})`;
}

function formulaLabel(formula: FlowFormulaSummary): string {
  return `Formula: ${formula.name} = ${formula.expression}`;
}

function mermaidAnnotations(flow: RenderFlow, options: GraphOptions): string[] {
  const root = flow.elementIds.get('start');
  if (root === undefined) {
    return [];
  }
  const variables = options.includeVariables
    ? flow.description.variables.flatMap((variable, index) => {
        const id = `f${flow.index}_v${index}`;
        return [`    ${id}[/"${mermaidText(variableLabel(variable))}"/]`, `    ${root} -. defines .-> ${id}`];
      })
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) => {
        const id = `f${flow.index}_x${index}`;
        return [`    ${id}["${mermaidText(formulaLabel(formula))}"]`, `    ${root} -. defines .-> ${id}`];
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

function calledFlow(flows: ReadonlyArray<RenderFlow>, subflow: FlowSubflowSummary): RenderFlow | undefined {
  return flows.find(
    (flow) =>
      flow.description.qualifiedName === subflow.flowName ||
      (!subflow.flowName.includes('__') && flow.description.apiName === subflow.flowName)
  );
}

function mermaidCalls(flow: RenderFlow, flows: ReadonlyArray<RenderFlow>): string[] {
  return flow.description.subflows.flatMap((subflow) => {
    const source = flow.elementIds.get(subflow.name);
    const target = calledFlow(flows, subflow)?.elementIds.get('start');
    return source === undefined || target === undefined ? [] : [`  ${source} -. "calls" .-> ${target}`];
  });
}

function renderMermaid(flows: ReadonlyArray<FlowDescription>, options: GraphOptions): string {
  const renderFlows = createRenderFlows(flows);
  const lines = ['flowchart TD'];
  for (const flow of renderFlows) {
    lines.push(
      `  subgraph f${flow.index}["${mermaidText(
        `${flow.description.qualifiedName} v${flow.description.versionNumber}`
      )}"]`
    );
    lines.push(
      ...flow.description.elements.map((element) => mermaidNode(flow.elementIds.get(element.name) ?? '', element))
    );
    lines.push(...mermaidConnectors(flow), ...mermaidAnnotations(flow, options), '  end');
  }
  lines.push(...renderFlows.flatMap((flow) => mermaidCalls(flow, renderFlows)));
  return `${lines.join('\n')}\n`;
}

function dotNode(id: string, label: string, shape: string): string {
  return `    ${id} [label=${JSON.stringify(label)}, shape=${shape}];`;
}

function dotElementNode(id: string, element: FlowElementSummary): string {
  const shape = element.type === 'Start' ? 'oval' : element.type === 'Decision' ? 'diamond' : 'box';
  return dotNode(id, elementLabel(element), shape);
}

function dotAnnotations(flow: RenderFlow, options: GraphOptions): string[] {
  const root = flow.elementIds.get('start');
  if (root === undefined) {
    return [];
  }
  const variables = options.includeVariables
    ? flow.description.variables.flatMap((variable, index) => {
        const id = `f${flow.index}_v${index}`;
        return [dotNode(id, variableLabel(variable), 'note'), `    ${root} -> ${id} [style=dashed, label="defines"];`];
      })
    : [];
  const formulas = options.includeFormulas
    ? flow.description.formulas.flatMap((formula, index) => {
        const id = `f${flow.index}_x${index}`;
        return [dotNode(id, formulaLabel(formula), 'note'), `    ${root} -> ${id} [style=dashed, label="defines"];`];
      })
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

function dotCalls(flow: RenderFlow, flows: ReadonlyArray<RenderFlow>): string[] {
  return flow.description.subflows.flatMap((subflow) => {
    const source = flow.elementIds.get(subflow.name);
    const target = calledFlow(flows, subflow)?.elementIds.get('start');
    return source === undefined || target === undefined
      ? []
      : [`  ${source} -> ${target} [style=dashed, label="calls"];`];
  });
}

function renderDot(flows: ReadonlyArray<FlowDescription>, options: GraphOptions): string {
  const renderFlows = createRenderFlows(flows);
  const lines = ['digraph Flow {', '  rankdir=TB;'];
  for (const flow of renderFlows) {
    lines.push(
      `  subgraph cluster_f${flow.index} {`,
      `    label=${JSON.stringify(`${flow.description.qualifiedName} v${flow.description.versionNumber}`)};`
    );
    lines.push(
      ...flow.description.elements.map((element) => dotElementNode(flow.elementIds.get(element.name) ?? '', element))
    );
    lines.push(...dotConnectors(flow), ...dotAnnotations(flow, options), '  }');
  }
  lines.push(...renderFlows.flatMap((flow) => dotCalls(flow, renderFlows)), '}');
  return `${lines.join('\n')}\n`;
}

export function renderFlowGraph(
  flows: ReadonlyArray<FlowDescription>,
  format: FlowGraphFormat,
  options: GraphOptions
): string {
  return format === 'dot' ? renderDot(flows, options) : renderMermaid(flows, options);
}
