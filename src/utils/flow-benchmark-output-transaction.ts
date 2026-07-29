/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkArtifact } from '../types/flow-benchmark.js';
import { discardFlowBenchmarkLogStage, type FlowBenchmarkDestinations } from './flow-benchmark-files.js';
import { writeFlowReport } from './flow-report-file.js';

interface StructuredOutputStage {
  backupFile: string;
  outputFile: string;
  stagedFile: string;
  stageDirectory: string;
  committed: boolean;
  previousOutput: boolean;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function stageStructuredOutput(
  outputFile: string,
  artifact: FlowBenchmarkArtifact
): Promise<StructuredOutputStage> {
  await mkdir(dirname(outputFile), { recursive: true });
  const stageDirectory = await mkdtemp(join(dirname(outputFile), '.sf-flow-benchmark-output-'));
  const stagedFile = join(stageDirectory, 'result.json');
  try {
    await writeFlowReport(stagedFile, JSON.stringify(artifact.result, null, 2), 0o600);
    return {
      backupFile: join(stageDirectory, 'previous-output'),
      outputFile,
      stagedFile,
      stageDirectory,
      committed: false,
      previousOutput: false,
    };
  } catch (error: unknown) {
    await rm(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function backupStructuredOutput(stage: StructuredOutputStage): Promise<StructuredOutputStage> {
  const previousOutput = await pathExists(stage.outputFile);
  if (previousOutput) {
    await rename(stage.outputFile, stage.backupFile);
  }
  return { ...stage, previousOutput };
}

async function commitStructuredOutput(stage: StructuredOutputStage): Promise<StructuredOutputStage> {
  await rename(stage.stagedFile, stage.outputFile);
  return { ...stage, committed: true };
}

async function removeCommittedOutput(stage: StructuredOutputStage): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (stage.committed) {
    await rm(stage.outputFile, { force: true }).catch((error: unknown) => errors.push(error));
  }
  return errors;
}

async function restorePreviousOutput(stage: StructuredOutputStage): Promise<unknown[]> {
  const errors: unknown[] = [];
  let outputExists = false;
  try {
    outputExists = await pathExists(stage.outputFile);
  } catch (error: unknown) {
    errors.push(error);
  }
  if (stage.previousOutput && !outputExists) {
    await rename(stage.backupFile, stage.outputFile).catch((error: unknown) => errors.push(error));
  }
  return errors;
}

async function rollbackStructuredOutput(stage: StructuredOutputStage): Promise<ReadonlyArray<unknown>> {
  const removalErrors = await removeCommittedOutput(stage);
  const restorationErrors = removalErrors.length === 0 ? await restorePreviousOutput(stage) : [];
  const errors = [...removalErrors, ...restorationErrors];
  if (errors.length === 0) {
    await rm(stage.stageDirectory, { recursive: true, force: true }).catch((error: unknown) => errors.push(error));
  }
  return errors;
}

async function recoverBenchmarkArtifacts(
  artifact: FlowBenchmarkArtifact,
  structuredStage: StructuredOutputStage | null,
  error: unknown
): Promise<never> {
  const [logCleanup, outputRollback] = await Promise.all([
    discardFlowBenchmarkLogStage(artifact.rawLogStage).then(
      () => [] as unknown[],
      (cleanupError: unknown) => [cleanupError]
    ),
    structuredStage === null ? Promise.resolve([]) : rollbackStructuredOutput(structuredStage),
  ]);
  if (logCleanup.length + outputRollback.length > 0) {
    const retained = await retainedBenchmarkRecoveryPaths([structuredStage?.stageDirectory, artifact.rawLogStage]);
    const recovery =
      retained.length === 0
        ? 'No recoverable staging path remains.'
        : `Recoverable staging data was retained at ${retained.map((file) => `"${file}"`).join(' and ')}.`;
    throw flowBenchmarkFailed(
      `Could not write the Flow benchmark output and recovery was incomplete. ${recovery}`,
      error
    );
  }
  throw flowBenchmarkFailed(
    'Could not write the Flow benchmark output. No output artifacts were committed and any previous structured output was restored.',
    error
  );
}

export async function retainedBenchmarkRecoveryPaths(
  candidates: ReadonlyArray<string | null | undefined>,
  exists: (file: string) => Promise<boolean> = pathExists
): Promise<string[]> {
  const paths = [
    ...new Set(candidates.filter((candidate): candidate is string => candidate !== null && candidate !== undefined)),
  ];
  const retained = await Promise.all(paths.map(async (file) => ((await exists(file)) ? file : null)));
  return retained.filter((file): file is string => file !== null);
}

async function publishBenchmarkLogs(
  destination: FlowBenchmarkDestinations,
  artifact: FlowBenchmarkArtifact
): Promise<void> {
  if (artifact.rawLogStage === null) {
    return;
  }
  if (destination.rawLogDir === undefined) {
    throw flowBenchmarkFailed('A staged benchmark log directory does not have a destination.');
  }
  if (await pathExists(destination.rawLogDir)) {
    throw flowBenchmarkFailed(`Raw benchmark log directory "${destination.rawLogDir}" already exists.`);
  }
  await rename(artifact.rawLogStage, destination.rawLogDir);
}

function committedArtifacts(destination: FlowBenchmarkDestinations, artifact: FlowBenchmarkArtifact): string {
  const committed = [
    ...(destination.outputFile === undefined ? [] : [`structured output "${destination.outputFile}"`]),
    ...(artifact.rawLogStage === null || destination.rawLogDir === undefined
      ? []
      : [`raw logs "${destination.rawLogDir}"`]),
  ];
  return committed.length === 0 ? 'no output artifacts' : committed.join(' and ');
}

async function cleanupStructuredStage(
  destination: FlowBenchmarkDestinations,
  artifact: FlowBenchmarkArtifact,
  stage: StructuredOutputStage | null
): Promise<void> {
  if (stage === null) {
    return;
  }
  try {
    await rm(stage.stageDirectory, { recursive: true, force: true });
  } catch (error: unknown) {
    throw flowBenchmarkFailed(
      `Flow benchmark ${committedArtifacts(destination, artifact)} was committed, but staging cleanup failed at "${
        stage.stageDirectory
      }".`,
      error
    );
  }
}

export async function persistFlowBenchmark(
  destination: FlowBenchmarkDestinations,
  artifact: FlowBenchmarkArtifact
): Promise<void> {
  let structuredStage: StructuredOutputStage | null = null;
  try {
    if (destination.outputFile !== undefined) {
      structuredStage = await stageStructuredOutput(destination.outputFile, artifact);
      structuredStage = await backupStructuredOutput(structuredStage);
      structuredStage = await commitStructuredOutput(structuredStage);
    }
    await publishBenchmarkLogs(destination, artifact);
  } catch (error: unknown) {
    await recoverBenchmarkArtifacts(artifact, structuredStage, error);
  }
  await cleanupStructuredStage(destination, artifact, structuredStage);
}
