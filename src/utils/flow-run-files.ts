/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { flowDebugFailed, flowInputInvalid, flowInvocationFailed } from '../errors/flow-errors.js';
import type { FlowDebugArtifact } from '../types/flow-debug.js';
import type { FlowRunResult } from '../types/flow-invocation.js';
import { validateFlowReportDestination, writeFlowReport } from './flow-report-file.js';

export interface FlowRunFileDestinations {
  outputFile: string | undefined;
  rawLogFile: string | undefined;
}

async function validateOutputFile(outputFile: string): Promise<string> {
  try {
    return await validateFlowReportDestination(outputFile);
  } catch (error: unknown) {
    throw flowInvocationFailed(`Could not use "${outputFile}" as the Flow invocation result destination.`, error);
  }
}

async function validateRawLogFile(rawLogFile: string): Promise<string> {
  try {
    return await validateFlowReportDestination(rawLogFile);
  } catch (error: unknown) {
    throw flowDebugFailed(`Could not use "${rawLogFile}" as the raw Salesforce debug-log destination.`, error);
  }
}

async function writeOutputFile(outputFile: string, result: FlowRunResult): Promise<void> {
  try {
    await writeFlowReport(outputFile, JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    throw flowInvocationFailed(`Could not write the Flow invocation result to "${outputFile}".`, error);
  }
}

async function writeRawLogFile(rawLogFile: string, rawLog: string): Promise<void> {
  try {
    await writeFlowReport(rawLogFile, rawLog, 0o600);
  } catch (error: unknown) {
    throw flowDebugFailed(`Could not write the raw Salesforce debug log to "${rawLogFile}".`, error);
  }
}

function assertDistinctDestinations(outputFile: string | undefined, rawLogFile: string | undefined): void {
  const outputPath = outputFile === undefined ? undefined : resolve(outputFile);
  const rawLogPath = rawLogFile === undefined ? undefined : resolve(rawLogFile);
  if (outputPath !== undefined && outputPath === rawLogPath) {
    throw flowInputInvalid('--output-file and --raw-log-file must resolve to different files.');
  }
  const outputPortable = outputPath?.normalize('NFC').toLowerCase();
  const rawLogPortable = rawLogPath?.normalize('NFC').toLowerCase();
  if (outputPortable !== undefined && outputPortable === rawLogPortable) {
    throw flowInputInvalid('--output-file and --raw-log-file must not differ only by case or Unicode normalisation.');
  }
}

async function existingFileIdentity(file: string | undefined): Promise<string | null> {
  if (file === undefined) {
    return null;
  }
  try {
    const details = await stat(file);
    return `${details.dev}:${details.ino}`;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function assertDistinctExistingFiles(
  outputFile: string | undefined,
  rawLogFile: string | undefined
): Promise<void> {
  const [outputIdentity, rawLogIdentity] = await Promise.all([
    existingFileIdentity(outputFile),
    existingFileIdentity(rawLogFile),
  ]);
  if (outputIdentity !== null && outputIdentity === rawLogIdentity) {
    throw flowInputInvalid('--output-file and --raw-log-file must identify different files.');
  }
}

export async function prepareFlowRunFiles(
  outputFile: string | undefined,
  rawLogFile: string | undefined
): Promise<FlowRunFileDestinations> {
  assertDistinctDestinations(outputFile, rawLogFile);
  const [validatedOutput, validatedRawLog] = await Promise.all([
    outputFile === undefined ? undefined : validateOutputFile(outputFile),
    rawLogFile === undefined ? undefined : validateRawLogFile(rawLogFile),
  ]);
  assertDistinctDestinations(validatedOutput, validatedRawLog);
  await assertDistinctExistingFiles(validatedOutput, validatedRawLog);
  return { outputFile: validatedOutput, rawLogFile: validatedRawLog };
}

export async function persistFlowRunFiles(
  destinations: FlowRunFileDestinations,
  artifact: FlowDebugArtifact<FlowRunResult>
): Promise<void> {
  if (destinations.outputFile !== undefined) {
    await writeOutputFile(destinations.outputFile, artifact.result);
  }
  if (destinations.rawLogFile !== undefined && !artifact.result.dryRun) {
    await writeRawLogFile(destinations.rawLogFile, artifact.rawLog);
  }
}
