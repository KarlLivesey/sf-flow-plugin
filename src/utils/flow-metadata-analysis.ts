/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { z } from 'zod';
import { z as zod } from 'zod';

import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowVersion } from '../types/flow.js';
import type {
  FlowApexActionSummary,
  FlowConnectorSummary,
  FlowDescription,
  FlowElementSummary,
  FlowFormulaSummary,
  FlowSubflowSummary,
  FlowVariableSummary,
} from '../types/flow-inspection.js';
import { qualifiedFlowName } from './flow-state.js';

interface AnalysisContext {
  definition: FlowDefinition;
  version: FlowVersion;
  metadata: JsonObject;
  depth: number;
}

const nullableString = zod.string().nullable().optional();

const variableSchema = zod.object({
  name: zod.string().min(1),
  dataType: zod.string().min(1),
  objectType: nullableString,
  apexClass: nullableString,
  isCollection: zod.boolean(),
  isInput: zod.boolean(),
  isOutput: zod.boolean(),
  description: nullableString,
});

const formulaSchema = zod.object({
  name: zod.string().min(1),
  dataType: zod.string().min(1),
  expression: zod.string(),
  scale: zod.number().nullable().optional(),
});

const elementSchema = zod.object({
  name: zod.string().min(1),
  label: nullableString,
});

const subflowSchema = elementSchema.extend({
  flowName: zod.string().min(1),
});

const actionSchema = elementSchema.extend({
  actionName: nullableString,
  actionType: zod.string().min(1),
});

const apexPluginSchema = elementSchema.extend({
  apexClass: nullableString,
});

const ELEMENT_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
  ['actionCalls', 'Action'],
  ['apexPluginCalls', 'Apex Plugin'],
  ['assignments', 'Assignment'],
  ['collectionProcessors', 'Collection Processor'],
  ['customErrors', 'Custom Error'],
  ['decisions', 'Decision'],
  ['loops', 'Loop'],
  ['orchestratedStages', 'Orchestrated Stage'],
  ['recordCreates', 'Record Create'],
  ['recordDeletes', 'Record Delete'],
  ['recordLookups', 'Record Lookup'],
  ['recordRollbacks', 'Record Rollback'],
  ['recordUpdates', 'Record Update'],
  ['screens', 'Screen'],
  ['steps', 'Step'],
  ['subflows', 'Subflow'],
  ['transforms', 'Transform'],
  ['waits', 'Wait'],
];

function parseMetadataArray<T>(metadata: JsonObject, key: string, schema: z.ZodType<T>): T[] {
  const result = zod.array(schema).safeParse(metadata[key] ?? []);
  if (!result.success) {
    throw flowInspectionFailed(`Salesforce returned malformed Flow metadata in "${key}".`);
  }
  return result.data;
}

function variables(metadata: JsonObject): FlowVariableSummary[] {
  return parseMetadataArray(metadata, 'variables', variableSchema).map((variable) => ({
    name: variable.name,
    dataType: variable.dataType,
    objectType: variable.objectType ?? null,
    apexClass: variable.apexClass ?? null,
    collection: variable.isCollection,
    input: variable.isInput,
    output: variable.isOutput,
    description: variable.description ?? null,
  }));
}

function formulas(metadata: JsonObject): FlowFormulaSummary[] {
  return parseMetadataArray(metadata, 'formulas', formulaSchema).map((formula) => ({
    name: formula.name,
    dataType: formula.dataType,
    expression: formula.expression,
    scale: formula.scale ?? null,
  }));
}

function subflows(metadata: JsonObject): FlowSubflowSummary[] {
  return parseMetadataArray(metadata, 'subflows', subflowSchema).map((subflow) => ({
    name: subflow.name,
    label: subflow.label ?? null,
    flowName: subflow.flowName,
  }));
}

function apexActions(metadata: JsonObject): FlowApexActionSummary[] {
  const calls = parseMetadataArray(metadata, 'actionCalls', actionSchema)
    .filter((action) => action.actionType.toLowerCase() === 'apex')
    .map((action) => ({
      name: action.name,
      label: action.label ?? null,
      actionName: action.actionName ?? null,
      actionType: action.actionType,
    }));
  const plugins = parseMetadataArray(metadata, 'apexPluginCalls', apexPluginSchema).map((plugin) => ({
    name: plugin.name,
    label: plugin.label ?? null,
    actionName: plugin.apexClass ?? null,
    actionType: 'apexPlugin',
  }));
  return [...calls, ...plugins];
}

function elementCollection(metadata: JsonObject, key: string, type: string): FlowElementSummary[] {
  return parseMetadataArray(metadata, key, elementSchema).map((element) => ({
    name: element.name,
    label: element.label ?? null,
    type,
  }));
}

function elements(metadata: JsonObject): FlowElementSummary[] {
  const executable = ELEMENT_COLLECTIONS.flatMap(([key, type]) => elementCollection(metadata, key, type));
  return [{ name: 'start', label: 'Start', type: 'Start' }, ...executable];
}

function objectLabel(value: JsonObject, fallback: string | null): string | null {
  const label = value.label ?? value.name;
  return typeof label === 'string' && label.length > 0 ? label : fallback;
}

function collectTargets(
  value: JsonValue,
  label: string | null,
  targets: Array<{ target: string; label: string | null }>
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTargets(
        item,
        typeof item === 'object' && item !== null && !Array.isArray(item) ? objectLabel(item, label) : label,
        targets
      );
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  collectObjectTargets(value, label, targets);
}

function collectObjectTargets(
  value: JsonObject,
  label: string | null,
  targets: Array<{ target: string; label: string | null }>
): void {
  const target = value.targetReference;
  if (typeof target === 'string' && target.length > 0) {
    targets.push({ target, label });
  }
  for (const child of Object.values(value)) {
    collectTargets(child, label, targets);
  }
}

function connectorsFor(metadata: JsonObject, element: FlowElementSummary): FlowConnectorSummary[] {
  const source = element.name;
  const value = source === 'start' ? metadata.start : metadataElement(metadata, element);
  if (value === undefined) {
    return [];
  }
  const targets: Array<{ target: string; label: string | null }> = [];
  collectTargets(value, null, targets);
  return targets.map((target) => ({ source, ...target }));
}

function metadataElement(metadata: JsonObject, element: FlowElementSummary): JsonValue | undefined {
  const collection = ELEMENT_COLLECTIONS.find(([, type]) => type === element.type);
  const values = collection === undefined ? undefined : metadata[collection[0]];
  return Array.isArray(values)
    ? values.find(
        (value) => typeof value === 'object' && value !== null && !Array.isArray(value) && value.name === element.name
      )
    : undefined;
}

function connectors(metadata: JsonObject, flowElements: ReadonlyArray<FlowElementSummary>): FlowConnectorSummary[] {
  const unique = new Map<string, FlowConnectorSummary>();
  for (const connector of flowElements.flatMap((element) => connectorsFor(metadata, element))) {
    unique.set(`${connector.source}\u0000${connector.target}\u0000${connector.label ?? ''}`, connector);
  }
  return [...unique.values()];
}

function collectObjectNames(value: JsonValue, key: string | null, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjectNames(item, key, names);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      collectObjectNames(child, childKey, names);
    }
  } else if ((key === 'object' || key === 'objectType') && typeof value === 'string' && value.length > 0) {
    names.add(value);
  }
}

function referencedObjects(metadata: JsonObject): string[] {
  const names = new Set<string>();
  collectObjectNames(metadata, null, names);
  return [...names].sort();
}

export function analyseFlowMetadata(context: AnalysisContext): FlowDescription {
  const flowElements = elements(context.metadata);
  return {
    apiName: context.definition.apiName,
    namespace: context.definition.namespace,
    qualifiedName: qualifiedFlowName(context.definition.apiName, context.definition.namespace),
    definitionId: context.definition.id,
    versionId: context.version.id,
    versionNumber: context.version.versionNumber,
    status: context.version.status,
    label: context.version.label,
    processType: context.version.processType,
    depth: context.depth,
    variables: variables(context.metadata),
    formulas: formulas(context.metadata),
    apexActions: apexActions(context.metadata),
    subflows: subflows(context.metadata),
    referencedObjects: referencedObjects(context.metadata),
    elements: flowElements,
    connectors: connectors(context.metadata, flowElements),
  };
}
