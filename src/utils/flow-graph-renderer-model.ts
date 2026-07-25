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
  FlowGraphCurve,
  FlowGraphDirection,
  FlowGraphElkOptions,
  FlowGraphLayoutSelection,
  FlowGraphResolvedCurve,
  FlowGraphResolvedDirection,
  FlowGraphResolvedElkOptions,
  FlowGraphResolvedLayout,
  FlowGraphStyle,
  FlowSubflowSummary,
  FlowVariableSummary,
} from '../types/flow-inspection.js';

export interface FlowGraphRenderOptions {
  includeVariables: boolean;
  includeFormulas: boolean;
  direction: FlowGraphResolvedDirection;
  layout: FlowGraphResolvedLayout;
  curve: FlowGraphResolvedCurve;
  elk: FlowGraphResolvedElkOptions;
  nodeSpacing: number;
  rankSpacing: number;
  legend: boolean;
  labelWidth: number;
  style: FlowGraphStyle;
}

export interface RenderFlow {
  description: FlowDescription;
  elements: FlowElementSummary[];
  index: number;
  elementIds: Map<string, string>;
}

function flowAdjacency(flow: FlowDescription): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const connector of flow.connectors) {
    adjacency.set(connector.source, [...(adjacency.get(connector.source) ?? []), connector.target]);
  }
  return adjacency;
}

function walkFlow(name: string, adjacency: ReadonlyMap<string, string[]>, visited: Set<string>): string[] {
  if (visited.has(name)) {
    return [];
  }
  visited.add(name);
  return [name, ...(adjacency.get(name) ?? []).flatMap((target) => walkFlow(target, adjacency, visited))];
}

function orderFlowElements(flow: FlowDescription): FlowElementSummary[] {
  const byName = new Map(flow.elements.map((element) => [element.name, element]));
  const start = flow.elements.find((element) => element.type === 'Start') ?? byName.get('start');
  if (start === undefined) {
    return [...flow.elements];
  }
  const visited = new Set<string>();
  const ordered = walkFlow(start.name, flowAdjacency(flow), visited).flatMap((name) => byName.get(name) ?? []);
  return [...ordered, ...flow.elements.filter((element) => !visited.has(element.name))];
}

export function createRenderFlows(flows: ReadonlyArray<FlowDescription>): RenderFlow[] {
  return flows.map((description, index) => {
    const elements = orderFlowElements(description);
    return {
      description,
      elements,
      index,
      elementIds: new Map(elements.map((element, elementIndex) => [element.name, `f${index}_e${elementIndex}`])),
    };
  });
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

function hasRepeatedEndpoint(connectors: FlowDescription['connectors'], endpoint: 'source' | 'target'): boolean {
  const seen = new Set<string>();
  return connectors.some((connector) => {
    const value = connector[endpoint];
    if (seen.has(value)) {
      return true;
    }
    seen.add(value);
    return false;
  });
}

function hasCycle(flow: FlowDescription): boolean {
  const adjacency = new Map<string, string[]>();
  for (const connector of flow.connectors) {
    adjacency.set(connector.source, [...(adjacency.get(connector.source) ?? []), connector.target]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }
    visiting.add(node);
    if ((adjacency.get(node) ?? []).some((target) => visit(target))) {
      return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return flow.elements.some((element) => visit(element.name));
}

function isComplexFlow(flow: FlowDescription): boolean {
  return (
    flow.elements.length > 12 ||
    flow.connectors.length > 12 ||
    hasRepeatedEndpoint(flow.connectors, 'source') ||
    hasRepeatedEndpoint(flow.connectors, 'target') ||
    hasCycle(flow)
  );
}

const SUPPORTED_LAYOUTS: FlowGraphResolvedLayout[] = ['dagre', 'elk'];

export function resolveGraphLayoutCandidates(layout: FlowGraphLayoutSelection): FlowGraphResolvedLayout[] {
  const requested = Array.isArray(layout) ? layout : [layout];
  if (requested.includes('auto')) {
    return [...SUPPORTED_LAYOUTS];
  }
  return [...new Set(requested)] as FlowGraphResolvedLayout[];
}

export function resolveGraphLayout(
  flows: ReadonlyArray<FlowDescription>,
  layout: FlowGraphLayoutSelection,
  elk?: FlowGraphElkOptions
): FlowGraphResolvedLayout {
  const candidates = resolveGraphLayoutCandidates(layout);
  const onlyCandidate = candidates[0];
  if (candidates.length === 1 && onlyCandidate !== undefined) {
    return onlyCandidate;
  }
  const preferred =
    flows.length > 1 || flows.some((flow) => isComplexFlow(flow)) ? ('elk' as const) : ('dagre' as const);
  if (
    elk !== undefined &&
    (elk.nodePlacement !== 'auto' ||
      elk.modelOrder !== 'auto' ||
      elk.cycleBreaking !== 'auto' ||
      elk.mergeEdges ||
      elk.forceNodeOrder)
  ) {
    return candidates.includes('elk') ? 'elk' : onlyCandidate ?? 'dagre';
  }
  return candidates.includes(preferred) ? preferred : onlyCandidate ?? 'dagre';
}

export function resolveGraphCurve(curve: FlowGraphCurve, layout: FlowGraphResolvedLayout): FlowGraphResolvedCurve {
  return curve === 'auto' ? (layout === 'elk' ? 'linear' : 'basis') : curve;
}

function resolveNodePlacement(
  requested: FlowGraphElkOptions['nodePlacement'],
  cyclic: boolean
): FlowGraphResolvedElkOptions['nodePlacement'] {
  if (requested !== 'auto') {
    return requested;
  }
  return cyclic ? 'network-simplex' : 'brandes-koepf';
}

function resolveCycleBreaking(
  requested: FlowGraphElkOptions['cycleBreaking'],
  cyclic: boolean
): FlowGraphResolvedElkOptions['cycleBreaking'] {
  if (requested !== 'auto') {
    return requested;
  }
  return cyclic ? 'greedy-model-order' : 'greedy';
}

export function resolveGraphElkOptions(
  flows: ReadonlyArray<FlowDescription>,
  requested: FlowGraphElkOptions
): FlowGraphResolvedElkOptions {
  const cyclic = flows.some((flow) => hasCycle(flow));
  const edgeHeavy = flows.length > 1 || flows.some((flow) => isComplexFlow(flow));
  return {
    nodePlacement: resolveNodePlacement(requested.nodePlacement, cyclic),
    modelOrder:
      requested.modelOrder === 'auto' ? (edgeHeavy ? 'prefer-edges' : 'nodes-and-edges') : requested.modelOrder,
    cycleBreaking: resolveCycleBreaking(requested.cycleBreaking, cyclic),
    mergeEdges: requested.mergeEdges,
    forceNodeOrder: requested.forceNodeOrder,
  };
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
