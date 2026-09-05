/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { execFile } from 'node:child_process';
import { basename, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { FlowSource } from '../types/flow-source.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import type { FlowSourceDirectory } from './flow-source-directory-service.js';

const execute = promisify(execFile);

function withinDirectory(directory: string, file: string): boolean {
  const relativeFile = relative(directory, file);
  return relativeFile !== '..' && !relativeFile.startsWith(`..${sep}`) && !relativeFile.startsWith(sep);
}

function addCallers(sources: FlowSource[], selectedNames: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const source of sources) {
      const name = qualifiedFlowName(source.apiName, source.namespace);
      const affected = source.description.subflows.some(({ flowName }) =>
        selectedNames.has(flowName.includes('__') ? flowName : qualifiedFlowName(flowName, source.namespace))
      );
      if (affected && !selectedNames.has(name)) {
        selectedNames.add(name);
        changed = true;
      }
    }
  }
}

/** Select tracked changes against a verified Git commit, retaining deleted names for caller impact. */
export async function changedFlowSources(
  directory: FlowSourceDirectory,
  selection: { changedSince?: string; includeCallers?: boolean }
): Promise<FlowSource[]> {
  if (selection.changedSince === undefined) {
    return directory.sources;
  }
  try {
    return await selectChanged(directory, selection);
  } catch (error: unknown) {
    throw flowSourceInvalid('Could not resolve --changed-since in the source directory Git repository.', error);
  }
}

async function selectChanged(
  directory: FlowSourceDirectory,
  selection: { changedSince?: string; includeCallers?: boolean }
): Promise<FlowSource[]> {
  const options = { cwd: directory.directory, maxBuffer: 64 * 1024 * 1024 };
  const root = (await execute('git', ['rev-parse', '--show-toplevel'], options)).stdout.trim();
  const revision = (
    await execute(
      'git',
      ['rev-parse', '--verify', '--end-of-options', `${selection.changedSince ?? ''}^{commit}`],
      options
    )
  ).stdout.trim();
  const diff = await execute(
    'git',
    ['diff', '--no-ext-diff', '--no-textconv', '--no-relative', '--name-only', '--no-renames', '-z', revision, '--'],
    options
  );
  const files = diff.stdout
    .split('\0')
    .filter((file) => file.endsWith('.flow-meta.xml'))
    .map((file) => resolve(root, file))
    .filter((file) => withinDirectory(directory.directory, file));
  const names = new Set(files.map((file) => basename(file, '.flow-meta.xml')));
  if (selection.includeCallers === true) {
    addCallers(directory.sources, names);
  }
  return directory.sources.filter((source) => names.has(qualifiedFlowName(source.apiName, source.namespace)));
}
