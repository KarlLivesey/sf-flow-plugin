/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowComparisonFailed } from '../../errors/flow-errors.js';
import { FlowComparisonService } from '../../services/flow-comparison-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowCompareRequest,
  FlowCompareResult,
  FlowComparisonVersionSelector,
  JsonValue,
} from '../../types/flow-analysis.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.compare');

export interface CompareFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  from: FlowComparisonVersionSelector;
  to: FlowComparisonVersionSelector;
  namespace: string | undefined;
  'api-version': string | undefined;
}

export function parseComparisonVersionSelector(input: string): FlowComparisonVersionSelector {
  if (input === 'active' || input === 'latest') {
    return input;
  }
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(Number(input))) {
    throw flowComparisonFailed(`Flow comparison version "${input}" is invalid.`);
  }
  return Number(input);
}

function createRequest(
  flags: CompareFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowCompareRequest {
  return { ...createNamedFlowRequest(flags, context), from: flags.from, to: flags.to };
}

function displayValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export default class FlowCompare extends SfCommand<FlowCompareResult> {
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
    from: Flags.custom<FlowComparisonVersionSelector>({
      char: 'f',
      default: 'active',
      summary: messages.getMessage('flags.from.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseComparisonVersionSelector(input)),
    })(),
    to: Flags.custom<FlowComparisonVersionSelector>({
      char: 't',
      default: 'latest',
      summary: messages.getMessage('flags.to.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseComparisonVersionSelector(input)),
    })(),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowCompareResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowComparisonService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await service.compare(createRequest(flags, context));
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<CompareFlagValues> {
    const { flags } = await this.parse(FlowCompare);
    return flags;
  }

  private writeHumanOutput(result: FlowCompareResult): void {
    const name = qualifiedFlowName(result.apiName, result.namespace);
    this.table({
      title: messages.getMessage('info.title', [name, result.fromVersion, result.toVersion]),
      data: result.changes.map((change) => ({
        ...change,
        before: displayValue(change.before),
        after: displayValue(change.after),
      })),
      columns: [
        { key: 'kind', name: 'Change' },
        { key: 'path', name: 'Path' },
        { key: 'before', name: 'Before' },
        { key: 'after', name: 'After' },
      ],
    });
    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.summary', [result.changes.length, name]));
    }
  }
}
