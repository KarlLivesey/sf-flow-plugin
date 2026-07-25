/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages, SfError } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowActivationFailed, flowVersionInvalid } from '../../errors/flow-errors.js';
import { FlowDefinitionService } from '../../services/flow-definition-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowActivationRequest, FlowActivationResult, FlowVersionSelector } from '../../types/flow.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { validateFlowApiName, validateNamespace } from '../../utils/flow-name-validation.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.activate');

export interface ActivateFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  version: FlowVersionSelector;
  namespace: string | undefined;
  'api-version': string | undefined;
  'dry-run': boolean;
}

export function parseFlowVersionSelector(input: string): FlowVersionSelector {
  if (input === 'latest') {
    return input;
  }
  if (!/^[1-9]\d*$/.test(input)) {
    throw flowVersionInvalid(input);
  }
  const version = Number(input);
  if (!Number.isSafeInteger(version)) {
    throw flowVersionInvalid(input);
  }
  return version;
}

function validateFlags(flags: ActivateFlagValues): void {
  validateFlowApiName(flags['api-name']);
  if (flags.namespace !== undefined) {
    validateNamespace(flags.namespace);
  }
}

function requireTargetOrg(org: Org | undefined): Org {
  if (org === undefined) {
    throw SfError.create({
      name: 'TargetOrgNotFound',
      message: 'No target org was provided or configured.',
      actions: ['Specify --target-org or configure the Salesforce CLI target-org value.'],
    });
  }
  return org;
}

function createRequest(flags: ActivateFlagValues, targetOrg: Org): FlowActivationRequest {
  const username = targetOrg.getUsername();
  if (username === undefined) {
    throw flowActivationFailed('The target org does not have an authenticated username.');
  }
  const base = {
    apiName: flags['api-name'],
    targetOrg: username,
    requestedVersion: flags.version,
    dryRun: flags['dry-run'],
  };
  const withNamespace = flags.namespace === undefined ? base : { ...base, namespace: flags.namespace };
  return flags['api-version'] === undefined ? withNamespace : { ...withNamespace, apiVersion: flags['api-version'] };
}

export default class FlowActivate extends SfCommand<FlowActivationResult> {
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
    version: Flags.custom<FlowVersionSelector>({
      char: 'v',
      default: 'latest',
      summary: messages.getMessage('flags.version.summary'),
      parse: (input: string): Promise<FlowVersionSelector> => Promise.resolve(parseFlowVersionSelector(input)),
    })(),
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

  public async run(): Promise<FlowActivationResult> {
    const flags = await this.parseFlags();
    validateFlags(flags);
    const targetOrg = requireTargetOrg(flags['target-org']);
    const connection = targetOrg.getConnection(flags['api-version']);
    const service = new FlowDefinitionService(new ToolingFlowDefinitionGateway(connection));
    const result = await withFlowProgress(this.spinner, 'activate', async (progress) =>
      service.activate(createRequest(flags, targetOrg), progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<ActivateFlagValues> {
    const { flags } = await this.parse(FlowActivate);
    return flags;
  }

  private writeHumanOutput(result: FlowActivationResult): void {
    if (this.jsonEnabled()) {
      return;
    }
    const qualifiedName = result.namespace === null ? result.apiName : `${result.namespace}__${result.apiName}`;
    const messageKey = result.dryRun ? 'info.dry-run' : result.changed ? 'info.activated' : 'info.unchanged';
    this.log(messages.getMessage(messageKey, [qualifiedName, result.activeVersion]));
  }
}
