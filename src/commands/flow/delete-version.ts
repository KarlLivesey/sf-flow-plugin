/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowDeleteVersionService } from '../../services/flow-delete-version-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowDeleteVersionRequest, FlowDeleteVersionResult } from '../../types/flow-deletion.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.delete-version');

export interface DeleteVersionFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'flow-version': number;
  'if-active-version': number | undefined;
  'if-latest-version': number | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
  'dry-run': boolean;
}

function createRequest(
  flags: DeleteVersionFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowDeleteVersionRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags['flow-version'],
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
    ...(flags['if-latest-version'] === undefined ? {} : { expectedLatestVersion: flags['if-latest-version'] }),
    dryRun: flags['dry-run'],
  };
}

export default class FlowDeleteVersion extends SfCommand<FlowDeleteVersionResult> {
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
    'flow-version': Flags.integer({
      required: true,
      summary: messages.getMessage('flags.flow-version.summary'),
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

  public async run(): Promise<FlowDeleteVersionResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowDeleteVersionService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'delete-version', async (progress) =>
      service.deleteVersion(createRequest(flags, context), progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<DeleteVersionFlagValues> {
    const { flags } = await this.parse(FlowDeleteVersion);
    return flags;
  }

  private writeHumanOutput(result: FlowDeleteVersionResult): void {
    if (this.jsonEnabled()) {
      return;
    }
    const name = qualifiedFlowName(result.apiName, result.namespace);
    this.log(messages.getMessage(result.dryRun ? 'info.dry-run' : 'info.deleted', [name, result.plan.versionNumber]));
  }
}
