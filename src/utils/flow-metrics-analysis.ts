/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowDescription } from '../types/flow-inspection.js';
import type { FlowMetricCounts, FlowMetricEntry } from '../types/flow-metrics.js';
import { analyseFlowLintMetadata, FLOW_DML_TYPES, FLOW_FAULT_PATH_COLLECTIONS } from './flow-lint-analysis.js';

function adjacency(description: FlowDescription): ReadonlyMap<string, ReadonlyArray<string>> {
  const graph = new Map<string, string[]>();
  for (const connector of description.connectors) {
    graph.set(connector.source, [...(graph.get(connector.source) ?? []), connector.target]);
  }
  return graph;
}

interface PathMetrics {
  depth: number;
  loopNesting: number;
}

interface PathContext {
  graph: ReadonlyMap<string, ReadonlyArray<string>>;
  loopNames: ReadonlySet<string>;
  path: ReadonlySet<string>;
}

function pathMetrics(node: string, context: PathContext): PathMetrics {
  if (context.path.has(node)) {
    return { depth: 0, loopNesting: 0 };
  }
  const visited = new Set(context.path).add(node);
  const children = (context.graph.get(node) ?? []).map((target) => pathMetrics(target, { ...context, path: visited }));
  const maximumDepth = Math.max(0, ...children.map((child) => child.depth));
  const maximumNesting = Math.max(0, ...children.map((child) => child.loopNesting));
  return {
    depth: (node === 'start' ? 0 : 1) + maximumDepth,
    loopNesting: (context.loopNames.has(node) ? 1 : 0) + maximumNesting,
  };
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

export function analyseFlowMetrics(metadata: JsonObject, description: FlowDescription): FlowMetricEntry {
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
  const paths = pathMetrics('start', { graph: adjacency(description), loopNames: loops, path: new Set() });
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
    maximumLoopNesting: paths.loopNesting,
    dmlElements: description.elements.filter((element) => FLOW_DML_TYPES.has(element.type)).length,
    dmlInsideLoops: findings.filter((finding) => finding.rule === 'dml-inside-loop').length,
    apexActions: description.apexActions.length,
    subflows: description.subflows.length,
    maximumPathDepth: paths.depth,
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
  'maximumLoopNesting',
  'dmlElements',
  'dmlInsideLoops',
  'apexActions',
  'subflows',
  'maximumPathDepth',
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
  'maximumLoopNesting',
  'maximumPathDepth',
  'maximumFanIn',
  'maximumFanOut',
]);

export function totalFlowMetrics(entries: ReadonlyArray<FlowMetricEntry>): FlowMetricCounts {
  return Object.fromEntries(
    countKeys.map((key) => [
      key,
      maximumKeys.has(key)
        ? Math.max(0, ...entries.map((entry) => entry[key]))
        : entries.reduce((total, entry) => total + entry[key], 0),
    ])
  ) as unknown as FlowMetricCounts;
}
