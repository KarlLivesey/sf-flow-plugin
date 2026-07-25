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
import type { FlowVersionsResult } from '../../types/flow.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.versions');

export interface VersionsFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
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
    const result = await service.getVersions(createNamedFlowRequest(flags, context));
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
