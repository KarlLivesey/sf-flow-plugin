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
  FlowGraphStyle,
  FlowSubflowSummary,
  FlowVariableSummary,
} from '../types/flow-inspection.js';

export interface FlowGraphRenderOptions {
  includeVariables: boolean;
  includeFormulas: boolean;
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

export function elementLabel(element: FlowElementSummary): string {
  return `${element.type}: ${element.label ?? element.name}`;
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
