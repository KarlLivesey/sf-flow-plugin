/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Dirent } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { FlowSubflowSummary, FlowTraversalWarning } from '../types/flow-inspection.js';
import type { FlowSource, FlowSourceFile } from '../types/flow-source.js';
import { boundedMap } from '../utils/bounded-map.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { parseFlowSourceFile, readFlowSourceFile, verifyFlowSourceSnapshot } from './flow-source-service.js';

const MAX_SOURCE_FILES = 2000;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const SOURCE_CONCURRENCY = 8;
const FLOW_SOURCE_SUFFIX = '.flow-meta.xml';

interface SourceFileWalk {
  pending: string[];
  files: string[];
}

async function directoryEntries(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    throw flowSourceInvalid(`Flow source directory "${directory}" could not be read.`, error);
  }
}

function collectDirectoryEntries(state: SourceFileWalk, directory: string, entries: Dirent[]): void {
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(FLOW_SOURCE_SUFFIX)) {
      state.files.push(entryPath);
      if (state.files.length > MAX_SOURCE_FILES) {
        throw flowSourceInvalid(`Flow source directory contains more than ${MAX_SOURCE_FILES} Flow files.`);
      }
    } else if (entry.isDirectory()) {
      state.pending.push(entryPath);
    }
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const state: SourceFileWalk = { pending: [directory], files: [] };
  while (state.pending.length > 0) {
    const current = state.pending.pop();
    if (current === undefined) {
      break;
    }
    // Sequential reads let the walker stop without scheduling the remainder of a large tree.
    // eslint-disable-next-line no-await-in-loop
    collectDirectoryEntries(state, current, await directoryEntries(current));
  }
  return state.files.sort();
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

function assertSourceByteBudget(files: ReadonlyArray<FlowSourceFile>): void {
  const totalBytes = files.reduce((total, file) => total + file.snapshot.size, 0);
  if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_SOURCE_BYTES) {
    throw flowSourceInvalid('Flow source directory exceeds the 256 MiB aggregate source-file safety limit.');
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
  const loadedFiles = await boundedMap(files, SOURCE_CONCURRENCY, readFlowSourceFile);
  assertSourceByteBudget(loadedFiles);
  const sources = await boundedMap(loadedFiles, SOURCE_CONCURRENCY, parseFlowSourceFile);
  assertUniqueIdentities(sources);
  return { directory: resolved, sources };
}

export async function verifyFlowSourceDirectory(directory: FlowSourceDirectory): Promise<void> {
  await boundedMap(directory.sources, SOURCE_CONCURRENCY, async (source) => verifyFlowSourceSnapshot(source.snapshot));
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
