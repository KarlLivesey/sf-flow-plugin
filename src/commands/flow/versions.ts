/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowVersionsService } from '../../services/flow-versions-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowSortOrder,
  FlowVersionsRequest,
  FlowVersionsResult,
  FlowVersionSort,
  FlowVersionStatusFilter,
} from '../../types/flow.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.versions');

export interface VersionsFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  status: FlowVersionStatusFilter[] | undefined;
  'created-before': string | undefined;
  'created-after': string | undefined;
  sort: FlowVersionSort;
  order: FlowSortOrder;
  limit: number | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(
  flags: VersionsFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowVersionsRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    statuses: flags.status ?? [],
    ...(flags['created-before'] === undefined ? {} : { createdBefore: flags['created-before'] }),
    ...(flags['created-after'] === undefined ? {} : { createdAfter: flags['created-after'] }),
    sort: flags.sort,
    order: flags.order,
    ...(flags.limit === undefined ? {} : { limit: flags.limit }),
  };
}

export default class FlowVersions extends SfCommand<FlowVersionsResult> {
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
    status: Flags.custom<FlowVersionStatusFilter>({
      multiple: true,
      options: ['Active', 'Draft', 'InvalidDraft', 'Obsolete'],
      summary: messages.getMessage('flags.status.summary'),
    })(),
    'created-before': Flags.string({
      summary: messages.getMessage('flags.created-before.summary'),
    }),
    'created-after': Flags.string({
      summary: messages.getMessage('flags.created-after.summary'),
    }),
    sort: Flags.custom<FlowVersionSort>({
      default: 'version',
      options: ['version', 'created', 'modified'],
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
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowVersionsResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowVersionsService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'versions', async (progress) =>
      service.getVersions(createRequest(flags, context), progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<VersionsFlagValues> {
    const { flags } = await this.parse(FlowVersions);
    return flags;
  }

  private writeHumanOutput(result: FlowVersionsResult): void {
    this.table({
      title: messages.getMessage('info.title', [qualifiedFlowName(result.apiName, result.namespace)]),
      data: result.versions.map((version) => ({ ...version })),
      columns: [
        { key: 'versionNumber', name: 'Version' },
        { key: 'status', name: 'Status' },
        { key: 'active', name: 'Active' },
        { key: 'latest', name: 'Latest' },
        { key: 'label', name: 'Label' },
        { key: 'processType', name: 'Process Type' },
        { key: 'createdDate', name: 'Created' },
        { key: 'lastModifiedDate', name: 'Last Modified' },
      ],
    });
  }
}
