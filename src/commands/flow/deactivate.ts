/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowDeactivationService } from '../../services/flow-deactivation-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowDeactivationRequest, FlowDeactivationResult } from '../../types/flow.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.deactivate');

export interface DeactivateFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
  'dry-run': boolean;
}

function createRequest(
  flags: DeactivateFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowDeactivationRequest {
  return { ...createNamedFlowRequest(flags, context), dryRun: flags['dry-run'] };
}

export default class FlowDeactivate extends SfCommand<FlowDeactivationResult> {
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
    'dry-run': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.dry-run.summary'),
    }),
  };

  public async run(): Promise<FlowDeactivationResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowDeactivationService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'deactivate', async () =>
      service.deactivate(createRequest(flags, context))
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<DeactivateFlagValues> {
    const { flags } = await this.parse(FlowDeactivate);
    return flags;
  }

  private writeHumanOutput(result: FlowDeactivationResult): void {
    if (this.jsonEnabled()) {
      return;
    }
    const name = qualifiedFlowName(result.apiName, result.namespace);
    const messageKey = result.dryRun ? 'info.dry-run' : result.changed ? 'info.deactivated' : 'info.unchanged';
    this.log(messages.getMessage(messageKey, [name, result.previousActiveVersion ?? 'none']));
  }
}
