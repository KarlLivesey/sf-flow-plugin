/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkArtifact, FlowBenchmarkControl } from '../types/flow-benchmark.js';
import { assertSeparateDestinations, type FlowBenchmarkDestinations } from './flow-benchmark-files.js';
import { validateFlowReportDestination } from './flow-report-file.js';

export async function prepareBenchmarkStream(
  file: string | undefined,
  destinations: FlowBenchmarkDestinations
): Promise<string | undefined> {
  if (file === undefined) {
    return undefined;
  }
  const target = await validateFlowReportDestination(file);
  assertSeparateDestinations(target, destinations.outputFile);
  assertSeparateDestinations(target, destinations.rawLogDir);
  await assertAbsent(target);
  return target;
}

async function assertAbsent(target: string): Promise<void> {
  try {
    await lstat(target);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  throw flowBenchmarkFailed(`Sample stream "${target}" already exists; choose a new file.`);
}

async function openStream(file: string | undefined, dryRun: boolean): Promise<FileHandle | undefined> {
  if (file === undefined || dryRun) {
    return undefined;
  }
  await mkdir(dirname(file), { recursive: true });
  return open(file, 'wx', 0o600);
}

/** Serialize writes with backpressure. Never delete partial measurements after failure or cancellation. */
export async function withBenchmarkStream(
  options: { file: string | undefined; dryRun: boolean; interruptListeners?: NodeJS.SignalsListener[] },
  execute: (control: FlowBenchmarkControl) => Promise<FlowBenchmarkArtifact>
): Promise<FlowBenchmarkArtifact> {
  const handle = await openStream(options.file, options.dryRun);
  // Only suspend the current command's immediate-exit listener, never unrelated listeners.
  options.interruptListeners?.forEach((listener) => {
    process.removeListener('SIGINT', listener);
  });
  try {
    return await runStream({ handle, file: options.file }, execute);
  } finally {
    options.interruptListeners?.forEach((listener) => {
      process.on('SIGINT', listener);
    });
    await handle?.close();
  }
}

function serializedWriter(handle: FileHandle | undefined): (value: object) => Promise<void> {
  let pending = Promise.resolve();
  return async (value) => {
    pending = pending.then(async () => {
      await handle?.writeFile(`${JSON.stringify(value)}\n`);
    });
    await pending;
  };
}

async function runStream(
  options: { handle: FileHandle | undefined; file: string | undefined },
  execute: (control: FlowBenchmarkControl) => Promise<FlowBenchmarkArtifact>
): Promise<FlowBenchmarkArtifact> {
  const controller = new AbortController();
  const interrupt = (): void => {
    controller.abort();
  };
  const append = serializedWriter(options.handle);
  process.on('SIGINT', interrupt);
  try {
    const artifact = await execute({
      signal: controller.signal,
      retainSamples: options.file === undefined,
      onSample: async (sample) => append({ type: 'sample', ...sample }),
    });
    Object.assign(artifact.result, options.file === undefined ? {} : { samplesFile: options.file });
    await append({ type: 'summary', result: artifact.result });
    return artifact;
  } finally {
    process.removeListener('SIGINT', interrupt);
  }
}
