/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { parseStringPromise } from 'xml2js';
import { z as zod } from 'zod';

import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowVersion } from '../types/flow.js';
import type { FlowDescription } from '../types/flow-inspection.js';
import type { FlowSource } from '../types/flow-source.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowApiName, validateNamespace } from '../utils/flow-name-validation.js';

const FLOW_SOURCE_SUFFIX = '.flow-meta.xml';
const FLOW_METADATA_NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';
const MAX_FLOW_SOURCE_BYTES = 20 * 1024 * 1024;

const ROOT_COLLECTIONS = new Set([
  'actionCalls',
  'apexPluginCalls',
  'assignments',
  'choices',
  'collectionProcessors',
  'constants',
  'customErrors',
  'decisions',
  'dynamicChoiceSets',
  'formulas',
  'loops',
  'orchestratedStages',
  'processMetadataValues',
  'recordCreates',
  'recordDeletes',
  'recordLookups',
  'recordRollbacks',
  'recordUpdates',
  'screens',
  'stages',
  'steps',
  'subflows',
  'textTemplates',
  'transforms',
  'variables',
  'waits',
]);

const BOOLEAN_FIELDS = new Set(['isCollection', 'isInput', 'isOutput']);
const NUMBER_FIELDS = new Set(['scale']);
const XML_DECLARATION_PATTERN = /<!\s*(?:DOCTYPE|ENTITY)\b/iu;

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

function scalar(value: string, key: string): JsonValue {
  if (BOOLEAN_FIELDS.has(key) && (value === 'true' || value === 'false')) {
    return value === 'true';
  }
  if (NUMBER_FIELDS.has(key) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    return Number(value);
  }
  return value;
}

function normaliseXmlValue(value: unknown, key: string): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => normaliseXmlValue(item, key));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([name]) => name !== '$')
      .map(([name, child]) => [name, normaliseXmlValue(child, name)] as const);
    return Object.fromEntries(entries) as JsonObject;
  }
  if (typeof value === 'string') {
    return scalar(value, key);
  }
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return value;
  }
  throw flowSourceInvalid(`Flow source contains an unsupported XML value in "${key}".`);
}

function normaliseRoot(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => name !== '$')
      .map(([name, child]) => {
        const normalised = normaliseXmlValue(child, name);
        return [name, ROOT_COLLECTIONS.has(name) && !Array.isArray(normalised) ? [normalised] : normalised];
      })
  ) as JsonObject;
}

async function parseXmlDocument(content: string, file: string): Promise<unknown> {
  if (XML_DECLARATION_PATTERN.test(content)) {
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
  const metadata = normaliseRoot(validatedRoot(await parseXmlDocument(content, file), file));
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

function validateSourceFileStat(sourceFile: string, fileStat: Awaited<ReturnType<typeof stat>>): void {
  if (!fileStat.isFile()) {
    throw flowSourceInvalid(`Flow source path "${sourceFile}" is not a regular file.`);
  }
  if (fileStat.size > MAX_FLOW_SOURCE_BYTES) {
    throw flowSourceInvalid(`Flow source file "${sourceFile}" exceeds the 20 MiB safety limit.`);
  }
}

async function resolveSourceFile(file: string): Promise<string> {
  const requested = resolve(file);
  try {
    const sourceFile = await realpath(requested);
    const fileStat = await stat(sourceFile);
    validateSourceFileStat(sourceFile, fileStat);
    return sourceFile;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'FlowSourceInvalid') {
      throw error;
    }
    throw flowSourceInvalid(`Flow source file "${requested}" could not be read.`, error);
  }
}

async function readSourceFile(sourceFile: string): Promise<string> {
  try {
    return await readFile(sourceFile, 'utf8');
  } catch (error: unknown) {
    throw flowSourceInvalid(`Flow source file "${sourceFile}" could not be read.`, error);
  }
}

export async function loadFlowSource(file: string): Promise<FlowSource> {
  const sourceFile = await resolveSourceFile(file);
  const identity = sourceIdentity(sourceFile);
  const metadata = await parseMetadata(await readSourceFile(sourceFile), sourceFile);
  return {
    ...identity,
    sourceFile,
    metadata,
    description: descriptionFor(sourceFile, identity, metadata),
  };
}
