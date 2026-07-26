/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { flowBundleFailed } from '../errors/flow-errors.js';
import type { FlowBundleFile } from '../types/flow-bundle.js';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeFlowBundleFiles(files: ReadonlyArray<FlowBundleFile>, overwrite: boolean): Promise<void> {
  const existing = overwrite
    ? []
    : (await Promise.all(files.map(async (file) => ((await exists(file.path)) ? file.path : null)))).filter(
        (file): file is string => file !== null
      );
  if (existing.length > 0) {
    throw flowBundleFailed(`Refusing to overwrite existing bundle file "${existing[0]}".`);
  }
  try {
    await Promise.all(files.map(async (file) => mkdir(dirname(file.path), { recursive: true })));
    await Promise.all(
      files.map(async (file) => writeFile(file.path, file.content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' }))
    );
  } catch (error: unknown) {
    throw flowBundleFailed('Could not write the Flow bundle.', error);
  }
}
