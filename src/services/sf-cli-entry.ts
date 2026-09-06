/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

const cliPackage = z.object({ name: z.literal('@salesforce/cli'), bin: z.object({ sf: z.string().min(1) }) });
const missingFile = z.object({ code: z.enum(['ENOENT', 'ENOTDIR']) });

async function validatedEntry(directory: string, bin: string): Promise<string> {
  const entry = await realpath(resolve(directory, bin));
  const location = relative(await realpath(directory), entry);
  if (location.startsWith('..') || isAbsolute(location) || !['.js', '.mjs', '.cjs'].includes(extname(entry))) {
    throw new Error('Salesforce CLI package has an invalid JavaScript entry point.');
  }
  if (!(await stat(entry)).isFile()) {
    throw new Error('Salesforce CLI entry point is not a file.');
  }
  return entry;
}

async function packageEntry(directory: string): Promise<string | undefined> {
  try {
    const parsed = cliPackage.safeParse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown);
    return parsed.success ? await validatedEntry(directory, parsed.data.bin.sf) : undefined;
  } catch (error: unknown) {
    if (missingFile.safeParse(error).success) {
      return undefined;
    }
    throw error;
  }
}

async function enclosingCli(script: string): Promise<string | undefined> {
  try {
    return await firstEntry(ancestors(dirname(await realpath(script))), packageEntry);
  } catch (error: unknown) {
    if (missingFile.safeParse(error).success) {
      return undefined;
    }
    throw error;
  }
}

function ancestors(directory: string): string[] {
  const locations: string[] = [];
  let current = directory;
  do {
    locations.push(current);
    current = dirname(current);
  } while (current !== locations[locations.length - 1]);
  return locations;
}

// Preserve search precedence and stop filesystem probes after the first match.
async function firstEntry(
  directories: string[],
  load: (directory: string) => Promise<string | undefined>
): Promise<string | undefined> {
  return directories.reduce(
    async (found, directory) => (await found) ?? load(directory),
    Promise.resolve<string | undefined>(undefined)
  );
}

async function pathEntry(directory: string): Promise<string | undefined> {
  // POSIX links, npm Windows shims, and Salesforce's installer layout.
  return (
    (await enclosingCli(join(directory, 'sf'))) ??
    (await packageEntry(join(directory, 'node_modules', '@salesforce', 'cli'))) ??
    (await packageEntry(join(directory, '..', 'client')))
  );
}

export interface SfCliLocation {
  hostScript?: string | undefined;
  searchPath?: string | undefined;
}

/** Resolve the CLI package's JavaScript bin; never execute or interpolate a command shim. */
export async function resolveSfCliEntry(location: SfCliLocation = {}): Promise<string> {
  const host = location.hostScript ?? process.argv[1];
  const hosted = host === undefined ? undefined : await enclosingCli(host);
  if (hosted !== undefined) {
    return hosted;
  }
  const searchPath =
    location.searchPath ?? Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
  const entry = await firstEntry(searchPath.split(delimiter).filter(Boolean), pathEntry);
  if (entry !== undefined) {
    return entry;
  }
  throw new Error('Could not locate the Salesforce CLI JavaScript entry point.');
}
