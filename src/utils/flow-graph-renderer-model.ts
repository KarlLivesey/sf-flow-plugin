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
  FlowGraphDirection,
  FlowGraphResolvedDirection,
  FlowGraphStyle,
  FlowSubflowSummary,
  FlowVariableSummary,
} from '../types/flow-inspection.js';

export interface FlowGraphRenderOptions {
  includeVariables: boolean;
  includeFormulas: boolean;
  direction: FlowGraphResolvedDirection;
  legend: boolean;
  labelWidth: number;
  style: FlowGraphStyle;
}

export interface RenderFlow {
  description: FlowDescription;
  index: number;
  elementIds: Map<string, string>;
}

export function createRenderFlows(flows: ReadonlyArray<FlowDescription>): RenderFlow[] {
  return flows.map((description, index) => ({
    description,
    index,
    elementIds: new Map(
      description.elements.map((element, elementIndex) => [element.name, `f${index}_e${elementIndex}`])
    ),
  }));
}

function isShortLinearFlow(flow: FlowDescription): boolean {
  const sources = new Set<string>();
  return (
    flow.elements.length <= 12 &&
    flow.connectors.every((connector) => {
      const unique = !sources.has(connector.source);
      sources.add(connector.source);
      return unique;
    })
  );
}

export function resolveGraphDirection(
  flows: ReadonlyArray<FlowDescription>,
  direction: FlowGraphDirection
): FlowGraphResolvedDirection {
  if (direction !== 'auto') {
    return direction;
  }
  return flows.length === 1 && flows[0] !== undefined && isShortLinearFlow(flows[0]) ? 'left-right' : 'top-down';
}

export function elementLabel(element: FlowElementSummary): string {
  return `${element.type}: ${element.label ?? element.name}`;
}

export function wrapGraphLabel(value: string, width: number, separator: string): string {
  const words = value.split(/\s+/u);
  const lines = words.reduce<string[]>((wrapped, word) => {
    const current = wrapped.at(-1);
    if (current === undefined || current.length + word.length + 1 > width) {
      return [...wrapped, word];
    }
    return [...wrapped.slice(0, -1), `${current} ${word}`];
  }, []);
  return lines.join(separator);
}

export function variableLabel(variable: FlowVariableSummary): string {
  const modes = [variable.input ? 'input' : '', variable.output ? 'output' : ''].filter(Boolean).join(', ');
  const type = variable.objectType ?? variable.apexClass ?? variable.dataType;
  return `Variable: ${variable.name} (${type}${modes.length > 0 ? `; ${modes}` : ''})`;
}

export function formulaLabel(formula: FlowFormulaSummary): string {
  return `Formula: ${formula.name} = ${formula.expression}`;
}

export function calledFlow(flows: ReadonlyArray<RenderFlow>, subflow: FlowSubflowSummary): RenderFlow | undefined {
  return flows.find(
    (flow) =>
      flow.description.qualifiedName === subflow.flowName ||
      (!subflow.flowName.includes('__') && flow.description.apiName === subflow.flowName)
  );
}
