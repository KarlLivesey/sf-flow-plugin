/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowListService } from '../../services/flow-list-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowListResult } from '../../types/flow.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.list');

export interface ListFlagValues {
  'target-org': Org | undefined;
  'api-version': string | undefined;
}

export default class FlowList extends SfCommand<FlowListResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      required: false,
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowListResult> {
    const flags = await this.parseFlags();
    const context = createFlowCommandContext(flags);
    const service = new FlowListService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'list', async (progress) =>
      service.list({ targetOrg: context.targetOrg }, progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<ListFlagValues> {
    const { flags } = await this.parse(FlowList);
    return flags;
  }

  private writeHumanOutput(result: FlowListResult): void {
    this.table({
      title: messages.getMessage('info.title', [result.definitions.length]),
      data: result.definitions.map((definition) => ({
        ...definition,
        namespace: definition.namespace ?? '-',
        activeVersion: definition.activeVersion ?? '-',
        latestVersion: definition.latestVersion ?? '-',
        label: definition.label ?? '-',
        processType: definition.processType ?? '-',
        status: definition.status ?? '-',
        lastModifiedDate: definition.lastModifiedDate ?? '-',
      })),
      columns: [
        { key: 'apiName', name: 'API Name' },
        { key: 'label', name: 'Label' },
        { key: 'processType', name: 'Type' },
        { key: 'namespace', name: 'Namespace' },
        { key: 'activeVersion', name: 'Active' },
        { key: 'latestVersion', name: 'Latest' },
        { key: 'status', name: 'Status' },
        { key: 'lastModifiedDate', name: 'Last Modified' },
      ],
    });
  }
}
