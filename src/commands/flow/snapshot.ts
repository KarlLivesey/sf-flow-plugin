/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import type { FlowSnapshotResult } from '../../types/flow-snapshot.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import { loadOrgDocuments } from '../../services/flow-document-service.js';
import { saveFlowSnapshot } from '../../services/flow-snapshot-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { documentFlags } from '../../utils/flow-document-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.snapshot');

export interface SnapshotFlagValues {
  'api-name': string[] | undefined;
  namespace: string | undefined;
  'flow-version': FlowComparisonVersionSelector;
  'target-org': Org | undefined;
  'api-version': string | undefined;
  'output-dir': string;
}

export default class FlowSnapshot extends SfCommand<FlowSnapshotResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');
  public static override readonly flags = {
    'api-name': documentFlags['api-name'],
    namespace: documentFlags.namespace,
    'flow-version': documentFlags['flow-version'],
    'target-org': documentFlags['target-org'],
    'api-version': documentFlags['api-version'],
    'output-dir': Flags.directory({
      required: true,
      summary: messages.getMessage('flags.output-dir.summary'),
    }),
  };

  public async run(): Promise<FlowSnapshotResult> {
    const flags = await this.parseFlags();
    const context = createFlowCommandContext(flags);
    const selection = {
      apiNames: flags['api-name'] ?? [],
      namespace: flags.namespace,
      version: flags['flow-version'],
      targetOrg: context.targetOrg,
    };
    const result = await withFlowProgress(this.spinner, 'snapshot', async (progress) => {
      const documents = await loadOrgDocuments(
        new ToolingFlowDefinitionGateway(context.connection),
        selection,
        progress
      );
      progress('writing-files', flags['output-dir'] + ' (' + String(documents.length) + ' Flows)');
      return saveFlowSnapshot(documents, selection, flags['output-dir']);
    });
    this.table({
      title: 'Snapshot: ' + flags['output-dir'],
      data: result.flows.map((flow) => ({ ...flow })),
      columns: [
        { key: 'file', name: 'Flow file' },
        { key: 'version', name: 'Version' },
        { key: 'status', name: 'Status' },
      ],
    });
    return result;
  }

  public async parseFlags(): Promise<SnapshotFlagValues> {
    return (await this.parse(FlowSnapshot)).flags;
  }
}
