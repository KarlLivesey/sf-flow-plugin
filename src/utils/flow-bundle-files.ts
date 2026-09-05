/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { flowBundleFailed } from '../errors/flow-errors.js';
import type { FlowBundleFile } from '../types/flow-bundle.js';
import { assertBundleTargetsSafe, safeBundleTarget, validatedBundleFiles } from './flow-bundle-path-safety.js';

interface StagedFile {
  stagedPath: string;
  targetPath: string;
}

export interface FlowBundleBackupFile {
  backupPath: string;
  targetPath: string;
}

export interface FlowBundleRollbackState {
  stageDir: string;
  backups: FlowBundleBackupFile[];
  installed: string[];
}

export interface FlowBundleRollbackOperations {
  removeInstalled(file: string): Promise<void>;
  restoreBackup(file: FlowBundleBackupFile): Promise<void>;
  removeStage(stageDir: string): Promise<void>;
}

interface BundleTransaction extends FlowBundleRollbackState {
  staged: StagedFile[];
}

interface PreparedTransaction {
  transaction: BundleTransaction;
  stale: string[];
}

type RemoveDirectory = (path: string, options: { force: true; recursive: true }) => Promise<void>;

const previousManifestSchema = z.object({
  rootFlow: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u),
  flows: z.array(z.object({ qualifiedName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/u) })),
});

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function parseManifest(content: string, description: string): z.infer<typeof previousManifestSchema> {
  try {
    return previousManifestSchema.parse(JSON.parse(content) as unknown);
  } catch (error: unknown) {
    throw flowBundleFailed(`${description} Flow bundle manifest is invalid.`, error);
  }
}

function replacementManifest(
  files: ReadonlyArray<FlowBundleFile>,
  manifestPath: string
): z.infer<typeof previousManifestSchema> {
  const currentFile = files.find((file) => file.path === manifestPath);
  if (currentFile === undefined) {
    throw flowBundleFailed('The replacement Flow bundle does not contain an ownership manifest.');
  }
  return parseManifest(currentFile.content, 'The replacement');
}

function assertSameBundleOwner(
  previous: z.infer<typeof previousManifestSchema>,
  current: z.infer<typeof previousManifestSchema>
): void {
  if (previous.rootFlow !== current.rootFlow) {
    throw flowBundleFailed(
      `Refusing to overwrite bundle "${previous.rootFlow}" with unrelated root Flow "${current.rootFlow}".`
    );
  }
}

async function previousFlowFiles(files: ReadonlyArray<FlowBundleFile>, outputDir: string): Promise<string[]> {
  const manifestPath = join(resolve(outputDir), '.sf-flow-bundle', 'manifest.json');
  if (!(await exists(manifestPath))) {
    return [];
  }
  const previous = parseManifest(await readFile(manifestPath, 'utf8'), 'The existing');
  assertSameBundleOwner(previous, replacementManifest(files, manifestPath));
  return previous.flows.map((flow) =>
    safeBundleTarget(outputDir, join(resolve(outputDir), 'flows', `${flow.qualifiedName}.flow-meta.xml`))
  );
}

async function staleFiles(
  files: ReadonlyArray<FlowBundleFile>,
  outputDir: string,
  overwrite: boolean
): Promise<string[]> {
  if (!overwrite) {
    return [];
  }
  const current = new Set(files.map((file) => file.path));
  return (await previousFlowFiles(files, outputDir)).filter((file) => !current.has(file));
}

async function assertTargetsAvailable(files: ReadonlyArray<FlowBundleFile>, overwrite: boolean): Promise<void> {
  if (overwrite) {
    return;
  }
  const existing = (await Promise.all(files.map(async (file) => ((await exists(file.path)) ? file.path : null)))).find(
    (file): file is string => file !== null
  );
  if (existing !== undefined) {
    throw flowBundleFailed(`Refusing to overwrite existing bundle file "${existing}".`);
  }
}

async function stageFiles(files: ReadonlyArray<FlowBundleFile>, stageDir: string): Promise<StagedFile[]> {
  const directory = join(stageDir, 'new');
  await mkdir(directory, { recursive: true });
  return files.reduce(async (previous, file, index) => {
    const staged = await previous;
    const stagedPath = join(directory, String(index));
    await writeFile(stagedPath, file.content, { encoding: 'utf8', flag: 'wx' });
    return [...staged, { stagedPath, targetPath: file.path }];
  }, Promise.resolve([] as StagedFile[]));
}

async function backupTargets(transaction: BundleTransaction, targets: ReadonlyArray<string>): Promise<void> {
  const directory = join(transaction.stageDir, 'backups');
  await mkdir(directory, { recursive: true });
  await targets.reduce(async (previous, targetPath, index) => {
    await previous;
    if (await exists(targetPath)) {
      const backupPath = join(directory, String(index));
      await rename(targetPath, backupPath);
      transaction.backups.push({ backupPath, targetPath });
    }
  }, Promise.resolve());
}

async function installFile(transaction: BundleTransaction, file: StagedFile, overwrite: boolean): Promise<void> {
  if (overwrite) {
    await rename(file.stagedPath, file.targetPath);
    transaction.installed.push(file.targetPath);
    return;
  }
  await link(file.stagedPath, file.targetPath);
  transaction.installed.push(file.targetPath);
  await rm(file.stagedPath, { force: true });
}

async function installStaged(transaction: BundleTransaction, overwrite: boolean): Promise<void> {
  await transaction.staged.reduce(async (previous, file) => {
    await previous;
    await mkdir(dirname(file.targetPath), { recursive: true });
    await installFile(transaction, file, overwrite);
  }, Promise.resolve());
}

function failed(results: ReadonlyArray<PromiseSettledResult<unknown>>): boolean {
  return results.some((result) => result.status === 'rejected');
}

const defaultRollbackOperations: FlowBundleRollbackOperations = {
  removeInstalled: async (file) => rm(file, { force: true }),
  restoreBackup: async (file) => {
    await mkdir(dirname(file.targetPath), { recursive: true });
    await rename(file.backupPath, file.targetPath);
  },
  removeStage: async (stageDir) => rm(stageDir, { recursive: true, force: true }),
};

export async function rollbackFlowBundleFiles(
  transaction: FlowBundleRollbackState,
  operations: FlowBundleRollbackOperations = defaultRollbackOperations
): Promise<void> {
  const removed = await Promise.allSettled(transaction.installed.map(async (file) => operations.removeInstalled(file)));
  const restored = await Promise.allSettled(transaction.backups.map(async (file) => operations.restoreBackup(file)));
  if (failed(removed) || failed(restored)) {
    throw new Error(
      `The Flow bundle rollback did not complete; staging directory "${transaction.stageDir}" was retained.`
    );
  }
  await operations.removeStage(transaction.stageDir);
}

async function commit(transaction: BundleTransaction, stale: ReadonlyArray<string>, overwrite: boolean): Promise<void> {
  const targets = [...new Set([...transaction.staged.map((file) => file.targetPath), ...stale])];
  await backupTargets(transaction, overwrite ? targets : stale);
  await installStaged(transaction, overwrite);
}

export async function removeFlowBundleStageDirectory(
  stageDir: string,
  outcome: 'committed' | 'preparation-failed',
  remove: RemoveDirectory = rm
): Promise<void> {
  try {
    await remove(stageDir, { recursive: true, force: true });
  } catch (error: unknown) {
    const message =
      outcome === 'committed'
        ? `The Flow bundle was written, but staging directory "${stageDir}" was retained and must be removed manually.`
        : `Flow bundle preparation failed and staging directory "${stageDir}" was retained and must be removed manually.`;
    throw flowBundleFailed(message, error);
  }
}

async function prepareTransaction(
  files: ReadonlyArray<FlowBundleFile>,
  overwrite: boolean,
  outputDir: string
): Promise<PreparedTransaction> {
  const { validated, stale } = await prepareTargets(files, overwrite, outputDir);
  const stageDir = await mkdtemp(join(resolve(outputDir), '.sf-flow-bundle-stage-'));
  const transaction: BundleTransaction = { stageDir, staged: [], backups: [], installed: [] };
  try {
    transaction.staged = await stageFiles(validated, stageDir);
    return { transaction, stale };
  } catch (error: unknown) {
    await removeFlowBundleStageDirectory(stageDir, 'preparation-failed');
    throw error;
  }
}

async function prepareTargets(
  files: ReadonlyArray<FlowBundleFile>,
  overwrite: boolean,
  outputDir: string
): Promise<{ stale: string[]; validated: FlowBundleFile[] }> {
  const validated = validatedBundleFiles(files, outputDir);
  await mkdir(resolve(outputDir), { recursive: true });
  await assertBundleTargetsSafe(
    outputDir,
    validated.map((file) => file.path),
    overwrite
  );
  await assertTargetsAvailable(validated, overwrite);
  const stale = await staleFiles(validated, outputDir, overwrite);
  await assertBundleTargetsSafe(outputDir, stale, true);
  return { stale, validated };
}

async function handleFailure(transaction: BundleTransaction, error: unknown): Promise<never> {
  try {
    await rollbackFlowBundleFiles(transaction);
  } catch (rollbackError: unknown) {
    throw flowBundleFailed(
      `Could not write the Flow bundle and rollback was incomplete; staging directory "${transaction.stageDir}" was retained.`,
      rollbackError
    );
  }
  throw flowBundleFailed('Could not write the Flow bundle; previous files were restored.', error);
}

export async function writeFlowBundleFiles(
  files: ReadonlyArray<FlowBundleFile>,
  overwrite: boolean,
  outputDir: string
): Promise<void> {
  const prepared = await prepareTransaction(files, overwrite, outputDir);
  try {
    await commit(prepared.transaction, prepared.stale, overwrite);
  } catch (error: unknown) {
    return handleFailure(prepared.transaction, error);
  }
  await removeFlowBundleStageDirectory(prepared.transaction.stageDir, 'committed');
}
