/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { constants } from 'node:fs';
import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

async function validateWritableAncestor(directory: string): Promise<void> {
  try {
    await assertWritableDirectory(directory);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw error;
    }
    await validateWritableAncestor(parent);
  }
}

async function assertWritableDirectory(directory: string): Promise<void> {
  const details = await stat(directory);
  if (!details.isDirectory()) {
    throw new Error(`Flow report parent path "${directory}" is not a directory.`);
  }
  await access(directory, constants.W_OK);
}

export async function validateFlowReportDestination(outputFile: string): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    const details = await stat(resolved);
    if (details.isDirectory()) {
      throw new Error(`Flow report destination "${resolved}" is a directory.`);
    }
    await access(resolved, constants.W_OK);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
    await validateWritableAncestor(dirname(resolved));
  }
  return resolved;
}

export async function writeFlowReport(outputFile: string, content: string): Promise<string> {
  const resolved = resolve(outputFile);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  return resolved;
}

export async function writeFlowReportFile(
  outputFile: string,
  content: string,
  createError: (message: string, cause: unknown) => Error
): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    return await writeFlowReport(resolved, content);
  } catch (error: unknown) {
    throw createError(`Could not write Flow report to "${resolved}".`, error);
  }
}
