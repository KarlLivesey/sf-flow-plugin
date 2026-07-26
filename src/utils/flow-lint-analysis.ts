/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowDescription, FlowElementSummary, FlowLintFinding } from '../types/flow-inspection.js';

const SALESFORCE_ID_PATTERN = /(?<![A-Za-z0-9])[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?(?![A-Za-z0-9])/gu;
const FAULT_PATH_TYPES = new Set(['Action', 'Apex Plugin', 'Record Create', 'Record Delete', 'Record Update']);
const DML_TYPES = new Set(['Record Create', 'Record Delete', 'Record Update']);
const RESOURCE_KEYS = new Set(['formulas', 'variables']);
const ELEMENT_KEYS: Readonly<Record<string, string>> = {
  Action: 'actionCalls',
  'Apex Plugin': 'apexPluginCalls',
  'Record Create': 'recordCreates',
  'Record Delete': 'recordDeletes',
  'Record Update': 'recordUpdates',
};

interface FindingLocation {
  element?: string;
  path?: string;
}

function finding(rule: FlowLintFinding['rule'], message: string, location: FindingLocation = {}): FlowLintFinding {
  return {
    rule,
    severity: 'warning',
    message,
    element: location.element ?? null,
    path: location.path ?? null,
  };
}

function adjacency(description: FlowDescription): ReadonlyMap<string, ReadonlyArray<string>> {
  const graph = new Map<string, string[]>();
  for (const connector of description.connectors) {
    const targets = graph.get(connector.source) ?? [];
    targets.push(connector.target);
    graph.set(connector.source, targets);
  }
  return graph;
}

interface ReachabilityContext {
  graph: ReadonlyMap<string, ReadonlyArray<string>>;
  target: string;
  visited: ReadonlySet<string>;
}

function canReach(source: string, context: ReachabilityContext): boolean {
  if (source === context.target) {
    return true;
  }
  if (context.visited.has(source)) {
    return false;
  }
  const visited = new Set(context.visited).add(source);
  return (context.graph.get(source) ?? []).some((next) => canReach(next, { ...context, visited }));
}

function reachableElements(description: FlowDescription): ReadonlySet<string> {
  const graph = adjacency(description);
  const reachable = new Set<string>();
  const pending = ['start'];
  while (pending.length > 0) {
    const element = pending.pop();
    if (element === undefined || reachable.has(element)) {
      continue;
    }
    reachable.add(element);
    pending.push(...(graph.get(element) ?? []));
  }
  return reachable;
}

function unconnectedFindings(description: FlowDescription): FlowLintFinding[] {
  const reachable = reachableElements(description);
  return description.elements
    .filter((element) => element.name !== 'start' && !reachable.has(element.name))
    .map((element) =>
      finding('unconnected-element', `${element.type} "${element.label ?? element.name}" is unreachable from start.`, {
        element: element.name,
      })
    );
}

function containsTargetReference(value: JsonValue): boolean {
  if (Array.isArray(value)) {
    return value.some(containsTargetReference);
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    (typeof value.targetReference === 'string' && value.targetReference.length > 0) ||
    Object.values(value).some(containsTargetReference)
  );
}

function metadataElement(metadata: JsonObject, element: FlowElementSummary): JsonObject | undefined {
  const key = ELEMENT_KEYS[element.type];
  const values = key === undefined ? undefined : metadata[key];
  if (!Array.isArray(values)) {
    return undefined;
  }
  const value = values.find(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      candidate.name === element.name
  );
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function missingFaultPathFindings(metadata: JsonObject, description: FlowDescription): FlowLintFinding[] {
  return description.elements
    .filter((element) => FAULT_PATH_TYPES.has(element.type))
    .filter((element) => {
      const value = metadataElement(metadata, element);
      return value === undefined || !containsTargetReference(value.faultConnector ?? null);
    })
    .map((element) =>
      finding(
        'missing-fault-path',
        `${element.type} "${element.label ?? element.name}" does not have a connected fault path.`,
        { element: element.name }
      )
    );
}

function dmlInsideLoopFindings(description: FlowDescription): FlowLintFinding[] {
  const graph = adjacency(description);
  const loops = description.elements.filter((element) => element.type === 'Loop');
  return description.elements
    .filter((element) => DML_TYPES.has(element.type))
    .flatMap((element) =>
      loops
        .filter(
          (loop) =>
            canReach(loop.name, { graph, target: element.name, visited: new Set() }) &&
            canReach(element.name, { graph, target: loop.name, visited: new Set() })
        )
        .map((loop) =>
          finding(
            'dml-inside-loop',
            `${element.type} "${element.label ?? element.name}" runs inside loop "${loop.label ?? loop.name}".`,
            { element: element.name }
          )
        )
    );
}

function collectHardCodedIdsFromObject(value: JsonObject, path: string, findings: FlowLintFinding[]): void {
  for (const [key, child] of Object.entries(value)) {
    collectHardCodedIds(child, path.length === 0 ? key : `${path}.${key}`, findings);
  }
}

function addHardCodedIdFindings(value: string, path: string, findings: FlowLintFinding[]): void {
  for (const match of value.matchAll(SALESFORCE_ID_PATTERN)) {
    findings.push(finding('hard-coded-id', `Salesforce ID "${match[0]}" is hard-coded in Flow metadata.`, { path }));
  }
}

function collectHardCodedIds(value: JsonValue, path: string, findings: FlowLintFinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectHardCodedIds(item, `${path}[${index}]`, findings);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    collectHardCodedIdsFromObject(value, path, findings);
    return;
  }
  if (typeof value === 'string') {
    addHardCodedIdFindings(value, path, findings);
  }
}

function referencesResource(value: JsonValue, name: string, rootKey: string | null = null): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => referencesResource(item, name, rootKey));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(
      ([key, child]) => !RESOURCE_KEYS.has(rootKey ?? key) && referencesResource(child, name, rootKey ?? key)
    );
  }
  if (typeof value !== 'string') {
    return false;
  }
  return value === name || value.startsWith(`${name}.`) || value.includes(`{!${name}}`);
}

function unusedResourceFindings(metadata: JsonObject, description: FlowDescription): FlowLintFinding[] {
  const variables = description.variables
    .filter((variable) => !variable.input && !variable.output)
    .map((variable) => ({ name: variable.name, type: 'Variable' }));
  const formulas = description.formulas.map((formula) => ({ name: formula.name, type: 'Formula' }));
  return [...variables, ...formulas]
    .filter((resource) => !referencesResource(metadata, resource.name))
    .map((resource) =>
      finding('unused-resource', `${resource.type} "${resource.name}" is defined but never referenced.`, {
        element: resource.name,
      })
    );
}

export function analyseFlowLintMetadata(metadata: JsonObject, description: FlowDescription): FlowLintFinding[] {
  const hardCodedIds: FlowLintFinding[] = [];
  collectHardCodedIds(metadata, '', hardCodedIds);
  return [
    ...unconnectedFindings(description),
    ...missingFaultPathFindings(metadata, description),
    ...dmlInsideLoopFindings(description),
    ...hardCodedIds,
    ...unusedResourceFindings(metadata, description),
  ];
}
