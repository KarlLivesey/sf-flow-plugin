/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowPruneService } from '../../services/flow-prune-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowPruneOrder, FlowPruneRequest, FlowPruneResult } from '../../types/flow.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.prune');

export interface PruneFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  keep: number;
  'keep-version': number[];
  ignore: number[];
  'keep-by': FlowPruneOrder;
  namespace: string | undefined;
  'api-version': string | undefined;
  'dry-run': boolean;
}

function createRequest(flags: PruneFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowPruneRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    keep: flags.keep,
    keepVersions: flags['keep-version'],
    ignoreVersions: flags.ignore,
    keepBy: flags['keep-by'],
    dryRun: flags['dry-run'],
  };
}

export default class FlowPrune extends SfCommand<FlowPruneResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'api-name': Flags.string({
      char: 'n',
      required: true,
      summary: messages.getMessage('flags.api-name.summary'),
    }),
    'target-org': Flags.requiredOrg({
      char: 'o',
      required: false,
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    keep: Flags.integer({
      default: 5,
      min: 0,
      summary: messages.getMessage('flags.keep.summary'),
    }),
    'keep-version': Flags.integer({
      default: [],
      min: 1,
      multiple: true,
      summary: messages.getMessage('flags.keep-version.summary'),
    }),
    ignore: Flags.integer({
      default: [],
      min: 1,
      multiple: true,
      summary: messages.getMessage('flags.ignore.summary'),
    }),
    'keep-by': Flags.custom<FlowPruneOrder>({
      default: 'created',
      options: ['created', 'modified'],
      summary: messages.getMessage('flags.keep-by.summary'),
      parse: (input: string): Promise<FlowPruneOrder> => Promise.resolve(input === 'modified' ? 'modified' : 'created'),
    })(),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
    'dry-run': Flags.boolean({
      allowNo: true,
      default: true,
      summary: messages.getMessage('flags.dry-run.summary'),
    }),
  };

  public async run(): Promise<FlowPruneResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowPruneService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'prune', async (progress) =>
      service.prune(createRequest(flags, context), progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<PruneFlagValues> {
    const { flags } = await this.parse(FlowPrune);
    return flags;
  }

  private writeHumanOutput(result: FlowPruneResult): void {
    const name = qualifiedFlowName(result.apiName, result.namespace);
    this.table({
      title: messages.getMessage('info.title', [name]),
      data: result.plannedDeletions.map((version) => ({ ...version })),
      columns: [
        { key: 'versionNumber', name: 'Version' },
        { key: 'status', name: 'Status' },
        { key: 'createdDate', name: 'Created' },
        { key: 'lastModifiedDate', name: 'Last Modified' },
        { key: 'id', name: 'ID' },
      ],
    });
    if (!this.jsonEnabled()) {
      if (!result.dryRun && !result.changed) {
        this.log(messages.getMessage('info.unchanged', [name, result.keep]));
        return;
      }
      const messageKey = result.dryRun ? 'info.dry-run' : 'info.pruned';
      this.log(messages.getMessage(messageKey, [result.plannedDeletions.length, name, result.keep]));
    }
  }
}
