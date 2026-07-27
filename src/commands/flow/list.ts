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
import type { FlowListRequest, FlowListResult, FlowListSort } from '../../types/flow-list.js';
import type { FlowSortOrder } from '../../types/flow.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { validateFlowApiName, validateNamespace } from '../../utils/flow-name-validation.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.list');

export interface ListFlagValues {
  'target-org': Org | undefined;
  'api-name': string[] | undefined;
  type: string[] | undefined;
  namespace: string[] | undefined;
  status: string[] | undefined;
  sort: FlowListSort;
  order: FlowSortOrder;
  limit: number | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: ListFlagValues, targetOrg: string): FlowListRequest {
  const apiNames = flags['api-name'] ?? [];
  const namespaces = flags.namespace ?? [];
  apiNames.forEach(validateFlowApiName);
  namespaces.forEach(validateNamespace);
  return {
    targetOrg,
    apiNames,
    types: flags.type ?? [],
    namespaces,
    statuses: flags.status ?? [],
    sort: flags.sort,
    order: flags.order,
    ...(flags.limit === undefined ? {} : { limit: flags.limit }),
  };
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
    'api-name': Flags.string({
      char: 'n',
      multiple: true,
      summary: messages.getMessage('flags.api-name.summary'),
    }),
    type: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.type.summary'),
    }),
    namespace: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    status: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.status.summary'),
    }),
    sort: Flags.custom<FlowListSort>({
      default: 'api-name',
      options: ['api-name', 'label', 'type', 'active-version', 'latest-version', 'modified'],
      summary: messages.getMessage('flags.sort.summary'),
    })(),
    order: Flags.custom<FlowSortOrder>({
      default: 'asc',
      options: ['asc', 'desc'],
      summary: messages.getMessage('flags.order.summary'),
    })(),
    limit: Flags.integer({
      summary: messages.getMessage('flags.limit.summary'),
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
      service.list(createRequest(flags, context.targetOrg), progress)
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
