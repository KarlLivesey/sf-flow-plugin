/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { flowExportFailed } from '../errors/flow-errors.js';

export async function writeFlowExport(outputFile: string, content: string): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, 'utf8');
    return resolved;
  } catch (error: unknown) {
    throw flowExportFailed(`Could not write Flow metadata to "${resolved}".`, error);
  }
}
