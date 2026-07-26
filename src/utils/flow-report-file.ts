/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function writeFlowReportFile(
  outputFile: string,
  content: string,
  createError: (message: string, cause: unknown) => Error
): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${content}\n`, 'utf8');
    return resolved;
  } catch (error: unknown) {
    throw createError(`Could not write Flow report to "${resolved}".`, error);
  }
}
