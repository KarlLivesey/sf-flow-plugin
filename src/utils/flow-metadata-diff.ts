/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonChange, FlowComparisonScope, JsonObject, JsonValue } from '../types/flow-analysis.js';

interface DiffContext {
  path: string;
  changes: FlowComparisonChange[];
  ignoreOrder: boolean;
}

export interface FlowMetadataDiffOptions {
  scopes?: ReadonlyArray<FlowComparisonScope>;
  ignoreOrder?: boolean;
}

const ELEMENT_COLLECTIONS = new Set([
  'actionCalls',
  'apexPluginCalls',
  'assignments',
  'collectionProcessors',
  'customErrors',
  'decisions',
  'loops',
  'orchestratedStages',
  'recordCreates',
  'recordDeletes',
  'recordLookups',
  'recordRollbacks',
  'recordUpdates',
  'screens',
  'steps',
  'subflows',
  'transforms',
  'waits',
]);

const RESOURCE_COLLECTIONS = new Set([
  'choices',
  'constants',
  'dynamicChoiceSets',
  'formulas',
  'stages',
  'textTemplates',
  'variables',
]);

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function itemName(value: JsonValue): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const name = value.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

function hasUniqueNames(values: ReadonlyArray<JsonValue>): boolean {
  const names = values.map(itemName);
  return names.every((name) => name !== undefined) && new Set(names).size === names.length;
}

function canIndexByName(before: ReadonlyArray<JsonValue>, after: ReadonlyArray<JsonValue>): boolean {
  return before.length + after.length > 0 && hasUniqueNames(before) && hasUniqueNames(after);
}

function namedValues(values: ReadonlyArray<JsonValue>): Map<string, JsonValue> {
  return new Map(values.map((value) => [itemName(value) ?? '', value]));
}

function addedChange(path: string, after: JsonValue): FlowComparisonChange {
  return { kind: 'added', path, after };
}

function removedChange(path: string, before: JsonValue): FlowComparisonChange {
  return { kind: 'removed', path, before };
}

function changedValue(path: string, before: JsonValue, after: JsonValue): FlowComparisonChange {
  return { kind: 'changed', path, before, after };
}

function nestedContext(context: DiffContext, path: string): DiffContext {
  return { path, changes: context.changes, ignoreOrder: context.ignoreOrder };
}

function diffObjects(before: JsonObject, after: JsonObject, context: DiffContext): void {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    diffValues(before[key], after[key], nestedContext(context, propertyPath(context.path, key)));
  }
}

function diffNamedArrays(
  before: ReadonlyArray<JsonValue>,
  after: ReadonlyArray<JsonValue>,
  context: DiffContext
): void {
  const beforeByName = namedValues(before);
  const afterByName = namedValues(after);
  const names = [...new Set([...beforeByName.keys(), ...afterByName.keys()])].sort();
  for (const name of names) {
    const path = `${context.path}[name=${JSON.stringify(name)}]`;
    diffValues(beforeByName.get(name), afterByName.get(name), nestedContext(context, path));
  }
}

function diffIndexedArrays(
  before: ReadonlyArray<JsonValue>,
  after: ReadonlyArray<JsonValue>,
  context: DiffContext
): void {
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index += 1) {
    diffValues(before[index], after[index], nestedContext(context, `${context.path}[${index}]`));
  }
}

function comparisonKey(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map(comparisonKey).join(',')}]`;
  }
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${comparisonKey(value[key] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function diffArrays(before: ReadonlyArray<JsonValue>, after: ReadonlyArray<JsonValue>, context: DiffContext): void {
  if (canIndexByName(before, after)) {
    diffNamedArrays(before, after, context);
    return;
  }
  const orderedBefore = context.ignoreOrder
    ? [...before].sort((left, right) => comparisonKey(left).localeCompare(comparisonKey(right)))
    : before;
  const orderedAfter = context.ignoreOrder
    ? [...after].sort((left, right) => comparisonKey(left).localeCompare(comparisonKey(right)))
    : after;
  diffIndexedArrays(orderedBefore, orderedAfter, context);
}

function diffValues(before: JsonValue | undefined, after: JsonValue | undefined, context: DiffContext): void {
  if (before === undefined && after !== undefined) {
    context.changes.push(addedChange(context.path, after));
  } else if (before !== undefined && after === undefined) {
    context.changes.push(removedChange(context.path, before));
  } else if (before !== undefined && after !== undefined && isJsonObject(before) && isJsonObject(after)) {
    diffObjects(before, after, context);
  } else if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, context);
  } else if (before !== after && before !== undefined && after !== undefined) {
    context.changes.push(changedValue(context.path, before, after));
  }
}

function normaliseMetadata(metadata: JsonObject): JsonObject {
  const normalised = { ...metadata };
  delete normalised.status;
  return normalised;
}

function topLevelKey(path: string): string | null {
  return /^\$\.([A-Za-z_$][A-Za-z0-9_$]*)/.exec(path)?.[1] ?? null;
}

function changeScope(change: FlowComparisonChange): FlowComparisonScope {
  if (/(?:Connector|connector|targetReference)/.test(change.path)) {
    return 'connectors';
  }
  const key = topLevelKey(change.path);
  if (key !== null && RESOURCE_COLLECTIONS.has(key)) {
    return 'resources';
  }
  if (key !== null && ELEMENT_COLLECTIONS.has(key)) {
    return 'elements';
  }
  return 'metadata';
}

export function compareFlowMetadata(
  before: JsonObject,
  after: JsonObject,
  options: FlowMetadataDiffOptions = {}
): FlowComparisonChange[] {
  const changes: FlowComparisonChange[] = [];
  diffObjects(normaliseMetadata(before), normaliseMetadata(after), {
    path: '$',
    changes,
    ignoreOrder: options.ignoreOrder ?? false,
  });
  const scopes = new Set(options.scopes ?? []);
  return scopes.size === 0 ? changes : changes.filter((change) => scopes.has(changeScope(change)));
}
