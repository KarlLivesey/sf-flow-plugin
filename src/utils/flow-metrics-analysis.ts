/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowDescription } from '../types/flow-inspection.js';
import type { AnalysedFlowMetricEntry, FlowMetricCounts } from '../types/flow-metrics.js';
import { analyseFlowLintMetadata, FLOW_DML_TYPES, FLOW_FAULT_PATH_COLLECTIONS } from './flow-lint-analysis.js';

function adjacency(description: FlowDescription): ReadonlyMap<string, ReadonlyArray<string>> {
  const graph = new Map<string, string[]>();
  for (const connector of description.connectors) {
    graph.set(connector.source, [...(graph.get(connector.source) ?? []), connector.target]);
  }
  return graph;
}

interface PathMetrics {
  depthUpperBound: number;
  loopNestingUpperBound: number;
}

interface PathContext {
  components: ReadonlyArray<ReadonlyArray<string>>;
  graph: ReadonlyMap<number, ReadonlySet<number>>;
  loopNames: ReadonlySet<string>;
  memo: Map<number, PathMetrics>;
}

interface ComponentState {
  index: number;
  lowLink: number;
  onStack: boolean;
}

interface ComponentContext {
  components: string[][];
  graph: ReadonlyMap<string, ReadonlyArray<string>>;
  stack: string[];
  states: Map<string, ComponentState>;
}

interface CondenseContext {
  componentByNode: ReadonlyMap<string, number>;
  graph: Map<number, Set<number>>;
}

function graphNodes(graph: ReadonlyMap<string, ReadonlyArray<string>>): string[] {
  return [...new Set(['start', ...graph.keys(), ...[...graph.values()].flatMap((targets) => targets)])];
}

function targetLowLink(target: string, lowLink: number, context: ComponentContext): number {
  const targetState = context.states.get(target);
  if (targetState === undefined) {
    visitComponent(target, context);
    const visitedTarget = context.states.get(target);
    return visitedTarget === undefined ? lowLink : Math.min(lowLink, visitedTarget.lowLink);
  }
  return targetState.onStack ? Math.min(lowLink, targetState.index) : lowLink;
}

function popComponentMember(context: ComponentContext): string | undefined {
  const member = context.stack.pop();
  const memberState = member === undefined ? undefined : context.states.get(member);
  if (memberState !== undefined) {
    memberState.onStack = false;
  }
  return member;
}

function extractComponent(root: string, context: ComponentContext): void {
  const component: string[] = [];
  while (context.stack.length > 0) {
    const member = popComponentMember(context);
    if (member === undefined) {
      break;
    }
    component.push(member);
    if (member === root) {
      break;
    }
  }
  context.components.push(component);
}

function visitComponent(node: string, context: ComponentContext): void {
  const nodeState = { index: context.states.size, lowLink: context.states.size, onStack: true };
  context.states.set(node, nodeState);
  context.stack.push(node);
  for (const target of context.graph.get(node) ?? []) {
    nodeState.lowLink = targetLowLink(target, nodeState.lowLink, context);
  }
  if (nodeState.lowLink === nodeState.index) {
    extractComponent(node, context);
  }
}

function stronglyConnectedComponents(
  graph: ReadonlyMap<string, ReadonlyArray<string>>
): ReadonlyArray<ReadonlyArray<string>> {
  const context: ComponentContext = { components: [], graph, stack: [], states: new Map() };
  for (const node of graphNodes(graph)) {
    if (!context.states.has(node)) {
      visitComponent(node, context);
    }
  }
  return context.components;
}

function addCondensedTargets(source: string, targets: ReadonlyArray<string>, context: CondenseContext): void {
  const sourceComponent = context.componentByNode.get(source);
  if (sourceComponent === undefined) {
    return;
  }
  const targetComponents = targets
    .map((target) => context.componentByNode.get(target))
    .filter((target): target is number => target !== undefined && target !== sourceComponent);
  context.graph.set(sourceComponent, new Set([...(context.graph.get(sourceComponent) ?? []), ...targetComponents]));
}

function condensedGraph(
  graph: ReadonlyMap<string, ReadonlyArray<string>>,
  components: ReadonlyArray<ReadonlyArray<string>>
): { graph: ReadonlyMap<number, ReadonlySet<number>>; start: number } {
  const componentByNode = new Map(
    components.flatMap((component, index) => component.map((node) => [node, index] as const))
  );
  const context: CondenseContext = { componentByNode, graph: new Map() };
  for (const [source, targets] of graph.entries()) {
    addCondensedTargets(source, targets, context);
  }
  return { graph: context.graph, start: componentByNode.get('start') ?? 0 };
}

function componentPathMetrics(component: number, context: PathContext): PathMetrics {
  const cached = context.memo.get(component);
  if (cached !== undefined) {
    return cached;
  }
  const children = [...(context.graph.get(component) ?? [])].map((target) => componentPathMetrics(target, context));
  const nodes = context.components[component] ?? [];
  const result = {
    depthUpperBound:
      nodes.filter((node) => node !== 'start').length + Math.max(0, ...children.map((child) => child.depthUpperBound)),
    loopNestingUpperBound:
      nodes.filter((node) => context.loopNames.has(node)).length +
      Math.max(0, ...children.map((child) => child.loopNestingUpperBound)),
  };
  context.memo.set(component, result);
  return result;
}

function pathMetrics(graph: ReadonlyMap<string, ReadonlyArray<string>>, loopNames: ReadonlySet<string>): PathMetrics {
  const components = stronglyConnectedComponents(graph);
  const condensed = condensedGraph(graph, components);
  return componentPathMetrics(condensed.start, {
    components,
    graph: condensed.graph,
    loopNames,
    memo: new Map(),
  });
}

function fanCounts(description: FlowDescription): { maximumFanIn: number; maximumFanOut: number } {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const connector of description.connectors) {
    fanIn.set(connector.target, (fanIn.get(connector.target) ?? 0) + 1);
    fanOut.set(connector.source, (fanOut.get(connector.source) ?? 0) + 1);
  }
  return {
    maximumFanIn: Math.max(0, ...fanIn.values()),
    maximumFanOut: Math.max(0, ...fanOut.values()),
  };
}

function uniqueFindingElements(
  findings: ReturnType<typeof analyseFlowLintMetadata>,
  rule: string
): ReadonlySet<string> {
  return new Set(
    findings.flatMap((finding) => (finding.rule === rule && finding.element !== null ? [finding.element] : []))
  );
}

export function analyseFlowMetrics(metadata: JsonObject, description: FlowDescription): AnalysedFlowMetricEntry {
  const findings = analyseFlowLintMetadata(metadata, description);
  const missingFaults = findings.filter((finding) => finding.rule === 'missing-fault-path').length;
  const faultCapable = description.elements.filter(
    (element) => FLOW_FAULT_PATH_COLLECTIONS[element.type] !== undefined
  ).length;
  const unused = findings.filter((finding) => finding.rule === 'unused-resource');
  const unreachable = findings.filter((finding) => finding.rule === 'unconnected-element');
  const loops = new Set(
    description.elements.filter((element) => element.type === 'Loop').map((element) => element.name)
  );
  const paths = pathMetrics(adjacency(description), loops);
  const fan = fanCounts(description);
  const decisions = description.elements.filter((element) => element.type === 'Decision');
  return {
    apiName: description.apiName,
    namespace: description.namespace,
    version: description.versionNumber,
    depth: description.depth,
    executableElements: description.elements.filter((element) => element.type !== 'Start').length,
    decisions: decisions.length,
    decisionOutcomes: description.connectors.filter(
      (connector) => decisions.some((decision) => decision.name === connector.source) && connector.kind === 'outcome'
    ).length,
    loops: loops.size,
    maximumLoopNestingUpperBound: paths.loopNestingUpperBound,
    dmlElements: description.elements.filter((element) => FLOW_DML_TYPES.has(element.type)).length,
    dmlInsideLoops: uniqueFindingElements(findings, 'dml-inside-loop').size,
    apexActions: description.apexActions.length,
    subflows: description.subflows.length,
    maximumPathDepthUpperBound: paths.depthUpperBound,
    faultCapableElements: faultCapable,
    faultConnectedElements: faultCapable - missingFaults,
    faultPathCoverage: faultCapable === 0 ? null : (faultCapable - missingFaults) / faultCapable,
    variables: description.variables.length,
    formulas: description.formulas.length,
    unusedResources: unused.length,
    referencedObjects: description.referencedObjects,
    ...fan,
    unreachableElements: unreachable.length,
    unusedResourceNames: unused.flatMap((finding) => (finding.element === null ? [] : [finding.element])),
    unreachableElementNames: unreachable.flatMap((finding) => (finding.element === null ? [] : [finding.element])),
  };
}

const countKeys: Array<keyof FlowMetricCounts> = [
  'executableElements',
  'decisions',
  'decisionOutcomes',
  'loops',
  'maximumLoopNestingUpperBound',
  'dmlElements',
  'dmlInsideLoops',
  'apexActions',
  'subflows',
  'maximumPathDepthUpperBound',
  'faultCapableElements',
  'faultConnectedElements',
  'variables',
  'formulas',
  'unusedResources',
  'maximumFanIn',
  'maximumFanOut',
  'unreachableElements',
];

const maximumKeys: ReadonlySet<keyof FlowMetricCounts> = new Set([
  'maximumLoopNestingUpperBound',
  'maximumPathDepthUpperBound',
  'maximumFanIn',
  'maximumFanOut',
]);

export function totalFlowMetrics(entries: ReadonlyArray<FlowMetricCounts>): FlowMetricCounts {
  return Object.fromEntries(
    countKeys.map((key) => [
      key,
      maximumKeys.has(key)
        ? Math.max(0, ...entries.map((entry) => entry[key]))
        : entries.reduce((total, entry) => total + entry[key], 0),
    ])
  ) as unknown as FlowMetricCounts;
}
