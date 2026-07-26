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
import type { FlowPruneOrder, FlowPruneRequest, FlowPruneResult, FlowVersionStatusFilter } from '../../types/flow.js';
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
  status: FlowVersionStatusFilter[] | undefined;
  'keep-by': FlowPruneOrder;
  'older-than': { days: number } | undefined;
  'if-active-version': number | undefined;
  'if-latest-version': number | undefined;
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
    statuses: flags.status ?? ['Draft', 'Obsolete', 'InvalidDraft'],
    keepBy: flags['keep-by'],
    ...(flags['older-than'] === undefined ? {} : { olderThanDays: flags['older-than'].days }),
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
    ...(flags['if-latest-version'] === undefined ? {} : { expectedLatestVersion: flags['if-latest-version'] }),
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
    status: Flags.custom<FlowVersionStatusFilter>({
      multiple: true,
      options: ['Draft', 'Obsolete', 'InvalidDraft'],
      summary: messages.getMessage('flags.status.summary'),
    })(),
    'keep-by': Flags.custom<FlowPruneOrder>({
      default: 'created',
      options: ['created', 'modified'],
      summary: messages.getMessage('flags.keep-by.summary'),
      parse: (input: string): Promise<FlowPruneOrder> => Promise.resolve(input === 'modified' ? 'modified' : 'created'),
    })(),
    'older-than': Flags.duration({
      unit: 'days',
      summary: messages.getMessage('flags.older-than.summary'),
    }),
    'if-active-version': Flags.integer({
      summary: messages.getMessage('flags.if-active-version.summary'),
    }),
    'if-latest-version': Flags.integer({
      summary: messages.getMessage('flags.if-latest-version.summary'),
    }),
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
      this.writeAgeProtection(result, name);
      if (!result.dryRun && !result.changed) {
        this.log(messages.getMessage('info.unchanged', [name, result.keep]));
        return;
      }
      if (result.dryRun) {
        this.log(messages.getMessage('info.dry-run', [result.plannedDeletions.length, name, result.keep]));
      } else {
        this.log(messages.getMessage('info.pruned', [result.plannedDeletions.length, name, result.keep]));
      }
    }
  }

  private writeAgeProtection(result: FlowPruneResult, name: string): void {
    if (result.olderThanDays !== null) {
      this.log(
        messages.getMessage('info.age-protected', [
          result.recentVersions.length,
          name,
          result.olderThanDays,
          result.keepBy,
        ])
      );
    }
  }
}
