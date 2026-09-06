/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { FlowSource } from '../types/flow-source.js';
import type { FlowSnapshotResult } from '../types/flow-snapshot.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { boundedMap } from '../utils/bounded-map.js';
import { assertBundleTargetsSafe } from '../utils/flow-bundle-path-safety.js';
import { readFlowSourceFile, parseFlowSourceFile } from './flow-source-service.js';
import { snapshotDigest } from './flow-snapshot-service.js';

const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u);
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
  targetOrg: z.string().min(1),
  versionSelector: z.union([z.literal('active'), z.literal('latest'), z.number().int().positive()]),
  selection: z.object({ apiNames: z.array(name), namespace: name.nullable() }),
  flows: z.array(
    z.object({
      apiName: name,
      namespace: name.nullable(),
      version: z.number().int().positive(),
      status: z.string().min(1),
      file: z.string().min(1),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
  ),
});

function validateEntries(manifest: FlowSnapshotResult): void {
  const names = manifest.flows.map((entry) => qualifiedFlowName(entry.apiName, entry.namespace));
  if (new Set(names).size !== names.length) {
    throw flowInspectionFailed('Snapshot contains duplicate qualified Flow identities.');
  }
  manifest.flows.forEach((entry) => {
    if (entry.file !== 'flows/' + qualifiedFlowName(entry.apiName, entry.namespace) + '.flow-meta.xml') {
      throw flowInspectionFailed('Snapshot contains an invalid Flow file path.');
    }
  });
}

async function safeSourceFile(directory: string, source: string): Promise<string> {
  const file = join(directory, source);
  await assertBundleTargetsSafe(directory, [file], true);
  const canonical = await realpath(file);
  if (!snapshotContainsSource(await realpath(directory), canonical)) {
    throw flowInspectionFailed('Snapshot source escapes its directory or is a symbolic link.');
  }
  return file;
}

/** Check canonical containment, including Windows relative paths that cross volumes. */
export function snapshotContainsSource(directory: string, source: string, paths = { relative, isAbsolute }): boolean {
  const location = paths.relative(directory, source);
  return location !== '' && !location.startsWith('..') && !paths.isAbsolute(location);
}

async function readEntry(directory: string, entry: FlowSnapshotResult['flows'][number]): Promise<FlowSource> {
  const file = await safeSourceFile(directory, entry.file);
  const loaded = await readFlowSourceFile(file);
  if (snapshotDigest(loaded.content) !== entry.sha256) {
    throw flowInspectionFailed('Snapshot source checksum does not match: ' + entry.file);
  }
  const source = await parseFlowSourceFile(loaded);
  if (source.apiName !== entry.apiName || source.namespace !== entry.namespace) {
    throw flowInspectionFailed('Snapshot source identity does not match its manifest.');
  }
  return source;
}

/** Validate manifest, file confinement and checksums before making org requests. */
export async function readFlowSnapshot(file: string): Promise<{ manifest: FlowSnapshotResult; sources: FlowSource[] }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
    const manifest = manifestSchema.parse(parsed);
    validateEntries(manifest);
    const directory = dirname(resolve(file));
    const sources = await boundedMap(manifest.flows, 4, async (entry) => readEntry(directory, entry));
    return { manifest, sources };
  } catch (error: unknown) {
    throw flowInspectionFailed('Could not read a complete, valid Flow snapshot.', error);
  }
}
