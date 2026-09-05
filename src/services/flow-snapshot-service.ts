/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import type { FlowDocument } from '../types/flow-document.js';
import type { FlowSnapshotResult } from '../types/flow-snapshot.js';
import type { FlowBundleFile } from '../types/flow-bundle.js';
import { renderFlowMetadataXmlForComparison } from '../utils/flow-metadata-xml.js';
import { writeFlowBundleFiles } from '../utils/flow-bundle-files.js';
import type { DocumentSelection } from './flow-document-service.js';

export function snapshotDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function snapshotFile(
  document: FlowDocument,
  directory: string
): { file: FlowBundleFile; entry: FlowSnapshotResult['flows'][number] } {
  const { description } = document;
  if (description.versionNumber === null) {
    throw flowInspectionFailed('Snapshots require resolved org versions.');
  }
  const relativeFile = 'flows/' + description.qualifiedName + '.flow-meta.xml';
  const content = renderFlowMetadataXmlForComparison(document.metadata);
  return {
    file: { path: join(directory, relativeFile), content },
    entry: {
      apiName: description.apiName,
      namespace: description.namespace,
      version: description.versionNumber,
      status: description.status,
      file: relativeFile,
      sha256: snapshotDigest(content),
    },
  };
}

/** Capture exact resolved metadata without activating it. Existing snapshot files are never overwritten. */
export async function saveFlowSnapshot(
  documents: ReadonlyArray<FlowDocument>,
  selection: DocumentSelection,
  outputDir: string
): Promise<FlowSnapshotResult> {
  const directory = resolve(outputDir);
  const files = documents.map((document) => snapshotFile(document, directory));
  const manifest: FlowSnapshotResult = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    targetOrg: selection.targetOrg,
    versionSelector: selection.version,
    selection: {
      apiNames: selection.apiNames.length === 0 ? [] : documents.map((document) => document.description.qualifiedName),
      namespace: selection.namespace ?? null,
    },
    flows: files.map((file) => file.entry),
  };
  await writeFlowBundleFiles(
    [
      ...files.map((file) => file.file),
      { path: join(directory, 'snapshot.json'), content: JSON.stringify(manifest, null, 2) + '\n' },
    ],
    false,
    directory
  );
  return manifest;
}
