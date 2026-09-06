/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Flags } from '@salesforce/sf-plugins-core';
import type { Org } from '@salesforce/core';
import { parseInspectionVersionSelector } from '../commands/flow/describe.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import { loadFlowSource } from '../services/flow-source-service.js';
import { loadFlowSourceDirectory } from '../services/flow-source-directory-service.js';
import { loadOrgDocuments, selectDocuments } from '../services/flow-document-service.js';
import { ToolingFlowDefinitionGateway } from '../services/tooling-flow-definition-gateway.js';
import type { FlowDocument } from '../types/flow-document.js';
import type { FlowComparisonVersionSelector } from '../types/flow-analysis.js';
import type { FlowProgressReporter } from './flow-progress.js';
import { createFlowCommandContext } from './flow-command.js';
import { validateFlowSourceFlags } from './flow-source-command.js';

export interface DocumentFlags {
  'source-file'?: string | undefined;
  'source-dir'?: string | undefined;
  'api-name'?: string[] | undefined;
  namespace?: string | undefined;
  'target-org': Org | undefined;
  'api-version': string | undefined;
  'flow-version': FlowComparisonVersionSelector;
}

export const documentFlags = {
  'source-file': Flags.file({
    exists: true,
    exclusive: ['source-dir'],
    summary: 'Read one local Flow XML file without an org.',
  }),
  'source-dir': Flags.directory({
    exists: true,
    exclusive: ['source-file'],
    summary: 'Read Flow XML files recursively from a local directory.',
  }),
  'api-name': Flags.string({
    char: 'n',
    multiple: true,
    summary: 'Select a Flow API name; repeat to select several Flows.',
  }),
  namespace: Flags.string({ summary: 'Select a Salesforce namespace.' }),
  'target-org': Flags.optionalOrg({ char: 'o', summary: 'Authenticated org; defaults to the configured target org.' }),
  'api-version': Flags.orgApiVersion({ summary: 'Salesforce API version.' }),
  'flow-version': Flags.custom<FlowComparisonVersionSelector>({
    default: 'latest',
    summary: 'Select active, latest, or a positive version number.',
    parse: (input: string): Promise<FlowComparisonVersionSelector> =>
      Promise.resolve(parseInspectionVersionSelector(input)),
  })(),
};

export function validateDocumentFlags(argv: ReadonlyArray<string>): void {
  for (const flag of ['source-file', 'source-dir']) {
    validateFlowSourceFlags(argv, ['target-org', 'api-version', 'flow-version'], flag);
  }
}

export async function commandDocuments(flags: DocumentFlags, progress: FlowProgressReporter): Promise<FlowDocument[]> {
  const selection = { apiNames: flags['api-name'] ?? [], namespace: flags.namespace };
  if (flags['source-file'] !== undefined || flags['source-dir'] !== undefined) {
    const sources =
      flags['source-file'] !== undefined
        ? [await loadFlowSource(flags['source-file'])]
        : (await loadFlowSourceDirectory(flags['source-dir'] ?? '')).sources;
    return selectDocuments(sources, selection).map((source) => ({
      metadata: source.metadata,
      description: source.description,
      sourceFile: source.sourceFile,
      targetOrg: null,
    }));
  }
  const context = createFlowCommandContext(flags);
  return loadOrgDocuments(
    new ToolingFlowDefinitionGateway(context.connection),
    { ...selection, version: flags['flow-version'], targetOrg: context.targetOrg },
    progress
  );
}

export function oneDocument(documents: FlowDocument[]): FlowDocument {
  if (documents.length !== 1 || documents[0] === undefined) {
    throw flowInspectionFailed('Select exactly one Flow using --api-name or --source-file.');
  }
  return documents[0];
}

/** Require an explicit single-Flow selection before any org metadata download. */
export async function commandDocument(flags: DocumentFlags, progress: FlowProgressReporter): Promise<FlowDocument> {
  if (flags['source-file'] === undefined && flags['api-name']?.length !== 1) {
    throw flowInspectionFailed('Select exactly one Flow using --api-name or --source-file.');
  }
  return oneDocument(await commandDocuments(flags, progress));
}
