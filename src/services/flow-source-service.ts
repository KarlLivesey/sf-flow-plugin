/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { open, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';

import { parseStringPromise } from 'xml2js';
import { z as zod } from 'zod';

import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowVersion } from '../types/flow.js';
import type { FlowDescription } from '../types/flow-inspection.js';
import type { FlowSource, FlowSourceFile, FlowSourceSnapshot } from '../types/flow-source.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowApiName, validateNamespace } from '../utils/flow-name-validation.js';
import { completeSourceRead } from '../utils/flow-source-file-read.js';
import { normaliseFlowSourceMetadata } from '../utils/flow-source-normalizer.js';
import { containsForbiddenXmlDeclaration, decodeFlowSource } from '../utils/flow-source-xml.js';

const FLOW_SOURCE_SUFFIX = '.flow-meta.xml';
const FLOW_METADATA_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

const flowMetadataSchema = zod
  .object({
    label: zod.string().min(1),
    processType: zod.string().min(1),
    status: zod.string().min(1),
  })
  .catchall(zod.unknown());

function parsedSourceIdentity(fileName: string): { apiName: string; namespace: string | null } {
  const qualifiedName = fileName.slice(0, -FLOW_SOURCE_SUFFIX.length);
  const separator = qualifiedName.indexOf('__');
  return {
    namespace: separator < 0 ? null : qualifiedName.slice(0, separator),
    apiName: separator < 0 ? qualifiedName : qualifiedName.slice(separator + 2),
  };
}

function validateSourceIdentity(identity: { apiName: string; namespace: string | null }, fileName: string): void {
  try {
    validateFlowApiName(identity.apiName);
    if (identity.namespace !== null) {
      validateNamespace(identity.namespace);
    }
  } catch (error: unknown) {
    throw flowSourceInvalid(`Flow source filename "${fileName}" does not contain a valid Flow API name.`, error);
  }
}

function sourceIdentity(file: string): { apiName: string; namespace: string | null } {
  const fileName = basename(file);
  if (!fileName.endsWith(FLOW_SOURCE_SUFFIX)) {
    throw flowSourceInvalid(`Flow source file "${file}" must end with "${FLOW_SOURCE_SUFFIX}".`);
  }
  const identity = parsedSourceIdentity(fileName);
  validateSourceIdentity(identity, fileName);
  return identity;
}

async function parseXmlDocument(content: string, file: string): Promise<unknown> {
  if (containsForbiddenXmlDeclaration(content)) {
    throw flowSourceInvalid(`Flow source file "${file}" contains a forbidden document type or entity declaration.`);
  }
  try {
    const parsed: unknown = await parseStringPromise(content, {
      explicitArray: false,
      explicitRoot: true,
      strict: true,
      trim: false,
    });
    return parsed;
  } catch (error: unknown) {
    throw flowSourceInvalid(`Flow source file "${file}" is not well-formed XML.`, error);
  }
}

function validatedRoot(parsed: unknown, file: string): Record<string, unknown> {
  const document = zod.object({ Flow: zod.record(zod.string(), zod.unknown()) }).safeParse(parsed);
  if (!document.success) {
    throw flowSourceInvalid(`Flow source file "${file}" must contain exactly one Flow root element.`);
  }
  const attributes = zod.record(zod.string(), zod.string()).safeParse(document.data.Flow.$);
  if (!attributes.success || attributes.data.xmlns !== FLOW_METADATA_NAMESPACE) {
    throw flowSourceInvalid(`Flow source file "${file}" does not use the Salesforce Metadata API namespace.`);
  }
  return document.data.Flow;
}

async function parseMetadata(content: string, file: string): Promise<JsonObject> {
  const metadata = normaliseFlowSourceMetadata(validatedRoot(await parseXmlDocument(content, file), file));
  if (!flowMetadataSchema.safeParse(metadata).success) {
    throw flowSourceInvalid(`Flow source file "${file}" is missing its label, processType or status.`);
  }
  return metadata;
}

function descriptionFor(
  sourceFile: string,
  identity: ReturnType<typeof sourceIdentity>,
  metadata: JsonObject
): FlowDescription {
  const values = flowMetadataSchema.parse(metadata);
  const definition: FlowDefinition = {
    id: sourceFile,
    apiName: identity.apiName,
    namespace: identity.namespace,
    activeVersionId: null,
    latestVersionId: null,
  };
  const version: FlowVersion = {
    id: sourceFile,
    definitionId: sourceFile,
    versionNumber: 1,
    status: values.status,
    label: values.label,
    processType: values.processType,
    createdDate: '',
    lastModifiedDate: '',
  };
  return {
    ...analyseFlowMetadata({ definition, version, metadata, depth: 0 }),
    definitionId: null,
    versionId: null,
    versionNumber: null,
  };
}

function validateSourceFileStat(sourceFile: string, fileStat: Stats): void {
  if (!fileStat.isFile()) {
    throw flowSourceInvalid(`Flow source path "${sourceFile}" is not a regular file.`);
  }
}

function snapshotFor(sourceFile: string, fileStat: Stats): FlowSourceSnapshot {
  return {
    sourceFile,
    device: fileStat.dev,
    inode: fileStat.ino,
    size: fileStat.size,
    modifiedMilliseconds: fileStat.mtimeMs,
    changedMilliseconds: fileStat.ctimeMs,
  };
}

function snapshotsMatch(left: FlowSourceSnapshot, right: FlowSourceSnapshot): boolean {
  return (
    left.sourceFile === right.sourceFile &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.size === right.size &&
    left.modifiedMilliseconds === right.modifiedMilliseconds &&
    left.changedMilliseconds === right.changedMilliseconds
  );
}

function sourceChanged(sourceFile: string): ReturnType<typeof flowSourceInvalid> {
  return flowSourceInvalid(`Flow source file "${sourceFile}" changed while it was being analysed.`);
}

async function resolveSourceFile(file: string): Promise<string> {
  const requested = resolve(file);
  try {
    return await realpath(requested);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowSourceInvalid') {
      throw error;
    }
    throw flowSourceInvalid(`Flow source file "${requested}" could not be read.`, error);
  }
}

async function readOpenedSource(
  sourceFile: string,
  fileHandle: FileHandle
): Promise<{ content: string; snapshot: FlowSourceSnapshot }> {
  const before = await fileHandle.stat();
  validateSourceFileStat(sourceFile, before);
  const buffer = await fileHandle.readFile();
  const after = await fileHandle.stat();
  const beforeSnapshot = snapshotFor(sourceFile, before);
  const afterSnapshot = snapshotFor(sourceFile, after);
  if (!snapshotsMatch(beforeSnapshot, afterSnapshot) || buffer.byteLength !== after.size) {
    throw sourceChanged(sourceFile);
  }
  return { content: decodeFlowSource(buffer, sourceFile), snapshot: afterSnapshot };
}

function normaliseSourceReadFailure(sourceFile: string, error: unknown): Error {
  return error instanceof Error && error.name === 'FlowSourceInvalid'
    ? error
    : flowSourceInvalid(`Flow source file "${sourceFile}" could not be read.`, error);
}

async function captureCloseFailure(fileHandle: FileHandle | undefined): Promise<unknown> {
  try {
    await fileHandle?.close();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

async function readSourceFile(sourceFile: string): Promise<{ content: string; snapshot: FlowSourceSnapshot }> {
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  let result: { content: string; snapshot: FlowSourceSnapshot } | undefined;
  let primaryFailure: Error | undefined;
  try {
    fileHandle = await open(sourceFile, 'r');
    result = await readOpenedSource(sourceFile, fileHandle);
  } catch (error: unknown) {
    primaryFailure = normaliseSourceReadFailure(sourceFile, error);
  }
  return completeSourceRead({
    sourceFile,
    result,
    primaryFailure,
    closeFailure: await captureCloseFailure(fileHandle),
  });
}

export async function verifyFlowSourceSnapshot(snapshot: FlowSourceSnapshot): Promise<void> {
  try {
    const currentSourceFile = await realpath(snapshot.sourceFile);
    const currentStat = await stat(currentSourceFile);
    validateSourceFileStat(currentSourceFile, currentStat);
    if (!snapshotsMatch(snapshot, snapshotFor(currentSourceFile, currentStat))) {
      throw sourceChanged(snapshot.sourceFile);
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowSourceInvalid') {
      throw error;
    }
    throw sourceChanged(snapshot.sourceFile);
  }
}

export async function readFlowSourceFile(file: string): Promise<FlowSourceFile> {
  const sourceFile = await resolveSourceFile(file);
  const { content, snapshot } = await readSourceFile(sourceFile);
  await verifyFlowSourceSnapshot(snapshot);
  return { sourceFile, content, snapshot };
}

export async function parseFlowSourceFile(file: FlowSourceFile): Promise<FlowSource> {
  const identity = sourceIdentity(file.sourceFile);
  const metadata = await parseMetadata(file.content, file.sourceFile);
  await verifyFlowSourceSnapshot(file.snapshot);
  return {
    ...identity,
    sourceFile: file.sourceFile,
    snapshot: file.snapshot,
    metadata,
    description: descriptionFor(file.sourceFile, identity, metadata),
  };
}

export async function loadFlowSource(file: string): Promise<FlowSource> {
  return parseFlowSourceFile(await readFlowSourceFile(file));
}

export { completeSourceRead };
