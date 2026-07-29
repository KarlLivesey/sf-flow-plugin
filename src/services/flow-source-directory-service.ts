/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { FlowSubflowSummary, FlowTraversalWarning } from '../types/flow-inspection.js';
import type { FlowSource } from '../types/flow-source.js';
import { boundedMap } from '../utils/bounded-map.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { loadFlowSource } from './flow-source-service.js';

const MAX_SOURCE_FILES = 2000;
const SOURCE_CONCURRENCY = 8;
const FLOW_SOURCE_SUFFIX = '.flow-meta.xml';

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(FLOW_SOURCE_SUFFIX))
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
  if (files.length > MAX_SOURCE_FILES) {
    throw flowSourceInvalid(`Flow source directory contains more than ${MAX_SOURCE_FILES} Flow files.`);
  }
  return files;
}

async function resolvedDirectory(directory: string): Promise<string> {
  const requested = resolve(directory);
  try {
    const resolved = await realpath(requested);
    if (!(await stat(resolved)).isDirectory()) {
      throw flowSourceInvalid(`Flow source path "${resolved}" is not a directory.`);
    }
    return resolved;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowSourceInvalid') {
      throw error;
    }
    throw flowSourceInvalid(`Flow source directory "${requested}" could not be read.`, error);
  }
}

function assertUniqueIdentities(sources: ReadonlyArray<FlowSource>): void {
  const identities = new Set<string>();
  for (const source of sources) {
    const name = qualifiedFlowName(source.apiName, source.namespace);
    if (identities.has(name)) {
      throw flowSourceInvalid(`Flow source directory contains more than one file for "${name}".`);
    }
    identities.add(name);
  }
}

export interface FlowSourceDirectory {
  directory: string;
  sources: FlowSource[];
}

export async function loadFlowSourceDirectory(directory: string): Promise<FlowSourceDirectory> {
  const resolved = await resolvedDirectory(directory);
  const files = await sourceFiles(resolved);
  if (files.length === 0) {
    throw flowSourceInvalid(`Flow source directory "${resolved}" does not contain any ${FLOW_SOURCE_SUFFIX} files.`);
  }
  const sources = await boundedMap(files, SOURCE_CONCURRENCY, loadFlowSource);
  assertUniqueIdentities(sources);
  return { directory: resolved, sources };
}

function sourceIndex(sources: ReadonlyArray<FlowSource>): ReadonlyMap<string, FlowSource> {
  return new Map(sources.map((source) => [qualifiedFlowName(source.apiName, source.namespace), source]));
}

function referencedSource(
  caller: FlowSource,
  flowName: string,
  sources: ReadonlyMap<string, FlowSource>
): FlowSource | undefined {
  return flowName.includes('__') ? sources.get(flowName) : sources.get(qualifiedFlowName(flowName, caller.namespace));
}

export interface LocalSourceTraversal {
  sources: FlowSource[];
  warnings: FlowTraversalWarning[];
}

export function inspectDirectLocalSubflows(
  root: FlowSource,
  allSources: ReadonlyArray<FlowSource>
): FlowTraversalWarning[] {
  const index = sourceIndex(allSources);
  const rootName = qualifiedFlowName(root.apiName, root.namespace);
  return root.description.subflows.flatMap((subflow) =>
    referencedSource(root, subflow.flowName, index) === undefined
      ? [{ kind: 'missing-subflow' as const, flowName: subflow.flowName, path: [rootName, subflow.flowName] }]
      : []
  );
}

interface TraversalPosition {
  source: FlowSource;
  depth: number;
  path: string[];
}

interface LocalTraversalState {
  index: ReadonlyMap<string, FlowSource>;
  queue: TraversalPosition[];
  discoveredDepths: Map<string, number>;
  visited: Set<string>;
  resolved: FlowSource[];
  warnings: FlowTraversalWarning[];
  maxDepth: number;
}

interface ResolvedLocalSubflow {
  target: FlowSource;
  targetName: string;
  nextPath: string[];
  nextDepth: number;
}

function resolveLocalSubflow(
  state: LocalTraversalState,
  position: TraversalPosition,
  subflow: FlowSubflowSummary
): ResolvedLocalSubflow | undefined {
  const nextPath = [...position.path, subflow.flowName];
  const target = referencedSource(position.source, subflow.flowName, state.index);
  if (target === undefined) {
    state.warnings.push({ kind: 'missing-subflow', flowName: subflow.flowName, path: nextPath });
    return undefined;
  }
  return {
    target,
    targetName: qualifiedFlowName(target.apiName, target.namespace),
    nextPath,
    nextDepth: position.depth + 1,
  };
}

function enqueueSubflow(state: LocalTraversalState, position: TraversalPosition, subflow: FlowSubflowSummary): void {
  const resolved = resolveLocalSubflow(state, position, subflow);
  if (
    resolved === undefined ||
    (state.discoveredDepths.get(resolved.targetName) ?? Number.POSITIVE_INFINITY) <= resolved.nextDepth
  ) {
    return;
  }
  if (position.depth >= state.maxDepth) {
    state.warnings.push({ kind: 'depth-limit', flowName: subflow.flowName, path: resolved.nextPath });
  } else {
    state.discoveredDepths.set(resolved.targetName, resolved.nextDepth);
    state.queue.push({ source: resolved.target, depth: resolved.nextDepth, path: resolved.nextPath });
  }
}

function drainTraversal(state: LocalTraversalState): void {
  while (state.queue.length > 0) {
    const position = state.queue.shift();
    if (position === undefined) {
      break;
    }
    const name = qualifiedFlowName(position.source.apiName, position.source.namespace);
    if (state.visited.has(name)) {
      continue;
    }
    state.visited.add(name);
    state.resolved.push(position.source);
    position.source.description.subflows.forEach((subflow) => {
      enqueueSubflow(state, position, subflow);
    });
  }
}

export function traverseLocalSubflows(
  root: FlowSource,
  allSources: ReadonlyArray<FlowSource>,
  maxDepth: number
): LocalSourceTraversal {
  const rootName = qualifiedFlowName(root.apiName, root.namespace);
  const state: LocalTraversalState = {
    index: sourceIndex(allSources),
    queue: [{ source: root, depth: 0, path: [rootName] }],
    discoveredDepths: new Map([[rootName, 0]]),
    visited: new Set(),
    resolved: [],
    warnings: [],
    maxDepth,
  };
  drainTraversal(state);
  return { sources: state.resolved, warnings: state.warnings };
}
