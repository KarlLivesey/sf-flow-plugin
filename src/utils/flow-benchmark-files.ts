/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkArtifact, FlowBenchmarkPhase } from '../types/flow-benchmark.js';
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

export async function writeFlowBenchmarkRawLog(
  stage: string,
  log: { phase: FlowBenchmarkPhase; sample: number; rawLog: string }
): Promise<void> {
  await writeFile(join(stage, rawLogFilename(log.phase, log.sample)), `${log.rawLog}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

export async function discardFlowBenchmarkLogStage(stage: string | null): Promise<void> {
  if (stage !== null) {
    await rm(stage, { recursive: true, force: true });
  }
}

async function publishFlowBenchmarkLogStage(stage: string, rawLogDir: string): Promise<void> {
  try {
    await lstat(rawLogDir);
    throw flowBenchmarkFailed(`Raw benchmark log directory "${rawLogDir}" already exists.`);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') {
      throw error;
    }
  }
  await rename(stage, rawLogDir);
}

export async function persistFlowBenchmark(
  destination: FlowBenchmarkDestinations,
  artifact: FlowBenchmarkArtifact
): Promise<void> {
  try {
    if (destination.outputFile !== undefined) {
      await writeFlowReport(destination.outputFile, JSON.stringify(artifact.result, null, 2));
    }
    if (artifact.rawLogStage !== null) {
      if (destination.rawLogDir === undefined) {
        throw flowBenchmarkFailed('A staged benchmark log directory does not have a destination.');
      }
      await publishFlowBenchmarkLogStage(artifact.rawLogStage, destination.rawLogDir);
    }
  } catch (error: unknown) {
    await discardFlowBenchmarkLogStage(artifact.rawLogStage);
    throw flowBenchmarkFailed('Could not write the Flow benchmark output.', error);
  }
}
