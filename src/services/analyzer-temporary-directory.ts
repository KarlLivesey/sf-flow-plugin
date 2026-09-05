/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flowCodeAnalyzerFailed } from '../errors/flow-errors.js';

export interface AnalyzerTemporaryDirectory {
  create(): Promise<string>;
  remove(directory: string): Promise<void>;
}

export const defaultAnalyzerTemporaryDirectory: AnalyzerTemporaryDirectory = {
  create: async (): Promise<string> => mkdtemp(join(tmpdir(), 'sf-flow-code-analyzer-')),
  remove: async (directory): Promise<void> => rm(directory, { recursive: true, force: true }),
};

export async function requiredAnalyzerTemporaryDirectory(create: () => Promise<string>): Promise<string> {
  try {
    return await create();
  } catch {
    throw flowCodeAnalyzerFailed('Salesforce Code Analyzer could not create its temporary working directory.');
  }
}

export async function cleanupAnalyzerTemporaryDirectory(
  cleanup: (directory: string) => Promise<void>,
  directory: string
): Promise<boolean> {
  try {
    await cleanup(directory);
    return true;
  } catch {
    return false;
  }
}
