/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkPhase } from '../types/flow-benchmark.js';
import { validateFlowReportDestination } from './flow-report-file.js';

export interface FlowBenchmarkDestinations {
  outputFile: string | undefined;
  rawLogDir: string | undefined;
  excludeWarmupLogs: boolean;
}

export interface FlowBenchmarkRawLog {
  phase: FlowBenchmarkPhase;
  sample: number;
  rawLog: string;
}

const RAW_LOG_WRITE_CONCURRENCY = 4;

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

function rawLogFilename(phase: FlowBenchmarkPhase, sample: number): string {
  return `${phase}-${String(sample).padStart(6, '0')}.log`;
}

export async function createFlowBenchmarkLogStage(rawLogDir: string | undefined): Promise<string | null> {
  if (rawLogDir === undefined) {
    return null;
  }
  await mkdir(dirname(rawLogDir), { recursive: true });
  return mkdtemp(join(dirname(rawLogDir), '.sf-flow-benchmark-'));
}

export async function writeFlowBenchmarkRawLog(stage: string, log: FlowBenchmarkRawLog): Promise<void> {
  await writeFile(join(stage, rawLogFilename(log.phase, log.sample)), `${log.rawLog}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

export async function writeFlowBenchmarkRawLogs(
  stage: string,
  logs: ReadonlyArray<FlowBenchmarkRawLog>
): Promise<void> {
  let nextIndex = 0;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    if (firstError !== undefined || nextIndex >= logs.length) {
      return;
    }
    const log = logs[nextIndex];
    nextIndex += 1;
    if (log === undefined) {
      return;
    }
    try {
      await writeFlowBenchmarkRawLog(stage, log);
    } catch (error: unknown) {
      firstError ??= error;
    }
    await worker();
  };
  const workerCount = Math.min(RAW_LOG_WRITE_CONCURRENCY, logs.length);
  await Promise.allSettled(Array.from({ length: workerCount }, worker));
  const failure = firstError;
  if (failure instanceof Error) {
    throw failure;
  }
  if (failure !== undefined) {
    throw flowBenchmarkFailed('Could not stage a raw Flow benchmark log.', failure);
  }
}

export async function discardFlowBenchmarkLogStage(stage: string | null): Promise<void> {
  if (stage !== null) {
    await rm(stage, { recursive: true, force: true });
  }
}
