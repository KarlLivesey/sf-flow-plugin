/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkArtifact, FlowBenchmarkRawLog } from '../types/flow-benchmark.js';
import { boundedMap } from './bounded-map.js';
import { validateFlowReportDestination, writeFlowReport } from './flow-report-file.js';

export interface FlowBenchmarkDestinations {
  outputFile: string | undefined;
  rawLogDir: string | undefined;
  excludeWarmupLogs: boolean;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function validateRawLogDirectory(directory: string): Promise<string> {
  const resolved = resolve(directory);
  try {
    await lstat(resolved);
    throw flowBenchmarkFailed(`Raw benchmark log directory "${resolved}" already exists.`);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  const sentinel = await validateFlowReportDestination(join(resolved, '.sf-flow-benchmark-log'));
  return dirname(sentinel);
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
  const location = relative(parent, candidate);
  return location === '' || (location !== '..' && !location.startsWith(`..${sep}`) && !isAbsolute(location));
}

function assertSeparateDestinations(outputFile: string | undefined, rawLogDir: string | undefined): void {
  if (outputFile === undefined || rawLogDir === undefined) {
    return;
  }
  const outputPortable = resolve(outputFile).normalize('NFC').toLowerCase();
  const logsPortable = resolve(rawLogDir).normalize('NFC').toLowerCase();
  if (isSameOrDescendant(logsPortable, outputPortable) || isSameOrDescendant(outputPortable, logsPortable)) {
    throw flowBenchmarkFailed('--output-file and --raw-log-dir must not contain one another.');
  }
}

export async function prepareFlowBenchmarkDestinations(
  outputFile: string | undefined,
  rawLogDir: string | undefined,
  excludeWarmupLogs: boolean
): Promise<FlowBenchmarkDestinations> {
  try {
    assertSeparateDestinations(outputFile, rawLogDir);
    const [validatedOutput, validatedRawLogs] = await Promise.all([
      outputFile === undefined ? undefined : validateFlowReportDestination(outputFile),
      rawLogDir === undefined ? undefined : validateRawLogDirectory(rawLogDir),
    ]);
    assertSeparateDestinations(validatedOutput, validatedRawLogs);
    return { outputFile: validatedOutput, rawLogDir: validatedRawLogs, excludeWarmupLogs };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowBenchmarkFailed') {
      throw error;
    }
    throw flowBenchmarkFailed('Could not validate the Flow benchmark output destinations.', error);
  }
}

function rawLogFilename(log: FlowBenchmarkRawLog): string {
  return `${log.phase}-${String(log.sample).padStart(6, '0')}.log`;
}

async function writeRawLogs(destination: FlowBenchmarkDestinations, logs: FlowBenchmarkRawLog[]): Promise<void> {
  if (destination.rawLogDir === undefined) {
    return;
  }
  const rawLogDir = destination.rawLogDir;
  await mkdir(dirname(rawLogDir), { recursive: true });
  await mkdir(rawLogDir);
  const selected = destination.excludeWarmupLogs ? logs.filter((log) => log.phase === 'measured') : logs;
  await boundedMap(selected, 25, async (log) =>
    writeFile(join(rawLogDir, rawLogFilename(log)), `${log.rawLog}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  );
}

export async function persistFlowBenchmark(
  destination: FlowBenchmarkDestinations,
  artifact: FlowBenchmarkArtifact
): Promise<void> {
  try {
    if (destination.outputFile !== undefined) {
      await writeFlowReport(destination.outputFile, JSON.stringify(artifact.result, null, 2));
    }
    if (!artifact.result.dryRun) {
      await writeRawLogs(destination, artifact.rawLogs);
    }
  } catch (error: unknown) {
    throw flowBenchmarkFailed('Could not write the Flow benchmark output.', error);
  }
}
