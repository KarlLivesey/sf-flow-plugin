/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

async function validateWritableAncestor(directory: string): Promise<string> {
  try {
    return await assertWritableDirectory(directory);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
    await assertPathAbsent(directory);
    const parent = dirname(directory);
    if (parent === directory) {
      throw error;
    }
    return join(await validateWritableAncestor(parent), basename(directory));
  }
}

async function assertWritableDirectory(directory: string): Promise<string> {
  const details = await stat(directory);
  if (!details.isDirectory()) {
    throw new Error(`Flow report parent path "${directory}" is not a directory.`);
  }
  await access(directory, constants.W_OK);
  return realpath(directory);
}

async function assertPathAbsent(file: string): Promise<void> {
  try {
    await lstat(file);
    throw new Error(`Flow report path "${file}" is an unresolved symbolic link.`);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
}

async function validateExistingDestination(file: string): Promise<string> {
  const details = await stat(file);
  if (details.isDirectory()) {
    throw new Error(`Flow report destination "${file}" is a directory.`);
  }
  if (!details.isFile()) {
    throw new Error(`Flow report destination "${file}" is not a regular file.`);
  }
  await access(file, constants.W_OK);
  return realpath(file);
}

export async function validateFlowReportDestination(outputFile: string): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    return await validateExistingDestination(resolved);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
    await assertPathAbsent(resolved);
    return join(await validateWritableAncestor(dirname(resolved)), basename(resolved));
  }
}

export async function writeFlowReport(outputFile: string, content: string, mode = 0o666): Promise<string> {
  const resolved = resolve(outputFile);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, content.endsWith('\n') ? content : `${content}\n`, { encoding: 'utf8', mode });
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
