/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import type { FlowDriftResult } from '../../types/flow-snapshot.js';
import { loadOrgDocuments } from '../../services/flow-document-service.js';
import { readFlowSnapshot } from '../../services/flow-snapshot-reader.js';
import { inspectFlowDrift } from '../../services/flow-drift-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { documentFlags } from '../../utils/flow-document-command.js';
import { withFlowProgress, type FlowProgressReporter } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.drift');

export interface DriftFlagValues {
  snapshot: string;
  'target-org': Org | undefined;
  'api-version': string | undefined;
  'fail-on-drift': boolean;
}

async function drift(
  snapshot: Awaited<ReturnType<typeof readFlowSnapshot>>,
  context: ReturnType<typeof createFlowCommandContext>,
  progress: FlowProgressReporter
): Promise<FlowDriftResult> {
  const selection = snapshot.manifest.selection;
  const documents = await loadOrgDocuments(
    new ToolingFlowDefinitionGateway(context.connection),
    {
      apiNames: selection.apiNames,
      namespace: selection.namespace ?? undefined,
      allowMissing: true,
      version: snapshot.manifest.versionSelector,
      targetOrg: context.targetOrg,
    },
    progress
  );
  return inspectFlowDrift(snapshot, documents, context.targetOrg);
}

export default class FlowDrift extends SfCommand<FlowDriftResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');
  public static override readonly flags = {
    snapshot: Flags.file({ required: true, exists: true, summary: messages.getMessage('flags.snapshot.summary') }),
    'target-org': documentFlags['target-org'],
    'api-version': documentFlags['api-version'],
    'fail-on-drift': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.fail-on-drift.summary'),
    }),
  };

  public async run(): Promise<FlowDriftResult> {
    const flags = await this.parseFlags();
    const snapshot = await readFlowSnapshot(flags.snapshot);
    const result = await withFlowProgress(this.spinner, 'drift', async (progress) =>
      drift(snapshot, createFlowCommandContext(flags), progress)
    );
    this.table({
      data: result.flows,
      columns: [
        { key: 'flow', name: 'Flow' },
        { key: 'kind', name: 'Drift' },
      ],
    });
    if (flags['fail-on-drift'] && result.different) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<DriftFlagValues> {
    return (await this.parse(FlowDrift)).flags;
  }
}
