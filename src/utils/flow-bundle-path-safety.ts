/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import { flowBundleFailed } from '../errors/flow-errors.js';
import type { FlowBundleFile } from '../types/flow-bundle.js';

const nodeErrorSchema = z.object({ code: z.string().optional() }).passthrough();

function outside(root: string, target: string): boolean {
  const location = relative(root, target);
  return location === '' || location.startsWith('..') || isAbsolute(location);
}

export function safeBundleTarget(outputDir: string, file: string): string {
  const root = resolve(outputDir);
  const target = resolve(file);
  if (outside(root, target)) {
    throw flowBundleFailed(`Bundle file "${file}" is outside the output directory.`);
  }
  return target;
}

export function validatedBundleFiles(files: ReadonlyArray<FlowBundleFile>, outputDir: string): FlowBundleFile[] {
  const validated = files.map((file) => ({ ...file, path: safeBundleTarget(outputDir, file.path) }));
  if (new Set(validated.map((file) => file.path)).size !== validated.length) {
    throw flowBundleFailed('The Flow bundle contains duplicate output paths.');
  }
  return validated;
}

async function existingDetails(file: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(file);
  } catch (error: unknown) {
    const parsed = nodeErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function ancestorPaths(root: string, target: string): string[] {
  const location = relative(root, dirname(target));
  const parts = location === '' ? [] : location.split(/[\\/]/u);
  return parts.reduce((paths, part) => [...paths, join(paths[paths.length - 1] ?? root, part)], [root]);
}

async function assertSafeAncestor(realRoot: string, ancestor: string): Promise<void> {
  const details = await existingDetails(ancestor);
  if (details === null) {
    return;
  }
  if (details.isSymbolicLink() || !details.isDirectory()) {
    throw flowBundleFailed(`Bundle output ancestor "${ancestor}" is not a safe directory.`);
  }
  const actual = await realpath(ancestor);
  if (actual !== realRoot && outside(realRoot, actual)) {
    throw flowBundleFailed(`Bundle output ancestor "${ancestor}" escapes the output directory.`);
  }
}

async function assertSafeTarget(root: string, realRoot: string, target: string): Promise<void> {
  await Promise.all(ancestorPaths(root, target).map(async (ancestor) => assertSafeAncestor(realRoot, ancestor)));
}

async function assertReplaceableTarget(target: string): Promise<void> {
  const details = await existingDetails(target);
  if (details !== null && (!details.isFile() || details.isSymbolicLink())) {
    throw flowBundleFailed(`Refusing to replace non-regular bundle target "${target}".`);
  }
}

export async function assertBundleTargetsSafe(
  outputDir: string,
  targets: ReadonlyArray<string>,
  replaceable: boolean
): Promise<void> {
  const root = resolve(outputDir);
  const realRoot = await realpath(root);
  await Promise.all(
    targets.map(async (target) => {
      await assertSafeTarget(root, realRoot, safeBundleTarget(root, target));
      if (replaceable) {
        await assertReplaceableTarget(target);
      }
    })
  );
}
