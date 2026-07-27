/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages, Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowComparisonFailed } from '../../errors/flow-errors.js';
import { FlowComparisonService } from '../../services/flow-comparison-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowCompareRequest,
  FlowCompareResult,
  FlowComparisonFormat,
  FlowComparisonScope,
  FlowComparisonVersionSelector,
} from '../../types/flow-analysis.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { renderFlowComparison } from '../../utils/flow-comparison-renderer.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReport } from '../../utils/flow-report-file.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.compare');

export interface CompareFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'from-org': Org | undefined;
  'to-org': Org | undefined;
  from: FlowComparisonVersionSelector;
  to: FlowComparisonVersionSelector;
  'fail-on-difference': boolean;
  only: FlowComparisonScope[] | undefined;
  'ignore-order': boolean;
  'ignore-path': string[] | undefined;
  format: FlowComparisonFormat;
  'output-file': string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

interface ComparisonContexts {
  from: ReturnType<typeof createFlowCommandContext>;
  to: ReturnType<typeof createFlowCommandContext>;
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

function createRequest(flags: CompareFlagValues, contexts: ComparisonContexts): FlowCompareRequest {
  return {
    ...createNamedFlowRequest(flags, contexts.from),
    from: flags.from,
    to: flags.to,
    fromOrg: contexts.from.targetOrg,
    toOrg: contexts.to.targetOrg,
    scopes: flags.only ?? [],
    ignoreOrder: flags['ignore-order'],
    ignorePaths: flags['ignore-path'] ?? [],
  };
}

function createComparisonContexts(flags: CompareFlagValues): ComparisonContexts {
  if (flags['from-org'] !== undefined && flags['to-org'] !== undefined) {
    return {
      from: createFlowCommandContext({ 'target-org': flags['from-org'], 'api-version': flags['api-version'] }),
      to: createFlowCommandContext({ 'target-org': flags['to-org'], 'api-version': flags['api-version'] }),
    };
  }
  const context = createFlowCommandContext(flags);
  return { from: context, to: context };
}

async function writeComparisonReport(outputFile: string, content: string): Promise<void> {
  try {
    await writeFlowReport(outputFile, content);
  } catch (error: unknown) {
    throw flowComparisonFailed(`Could not write the Flow comparison to "${outputFile}".`, error);
  }
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
      exclusive: ['from-org', 'to-org'],
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'from-org': Flags.custom<Org>({
      required: false,
      dependsOn: ['to-org'],
      exclusive: ['target-org'],
      summary: messages.getMessage('flags.from-org.summary'),
      parse: async (input: string): Promise<Org> => Org.create({ aliasOrUsername: input }),
    })(),
    'to-org': Flags.custom<Org>({
      required: false,
      dependsOn: ['from-org'],
      exclusive: ['target-org'],
      summary: messages.getMessage('flags.to-org.summary'),
      parse: async (input: string): Promise<Org> => Org.create({ aliasOrUsername: input }),
    })(),
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
    'fail-on-difference': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.fail-on-difference.summary'),
    }),
    only: Flags.custom<FlowComparisonScope>({
      multiple: true,
      options: ['metadata', 'elements', 'resources', 'connectors'],
      summary: messages.getMessage('flags.only.summary'),
    })(),
    'ignore-order': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.ignore-order.summary'),
    }),
    'ignore-path': Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.ignore-path.summary'),
    }),
    format: Flags.custom<FlowComparisonFormat>({
      default: 'summary',
      options: ['summary', 'unified', 'markdown'],
      summary: messages.getMessage('flags.format.summary'),
    })(),
    'output-file': Flags.file({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
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
    const contexts = createComparisonContexts(flags);
    const fromGateway = new ToolingFlowDefinitionGateway(contexts.from.connection);
    const service =
      contexts.from === contexts.to
        ? new FlowComparisonService(fromGateway)
        : new FlowComparisonService(fromGateway, new ToolingFlowDefinitionGateway(contexts.to.connection));
    const result = await withFlowProgress(this.spinner, 'compare', async (progress) =>
      service.compare(createRequest(flags, contexts), progress)
    );
    await this.writeOutput(result, flags);
    if (flags['fail-on-difference'] && result.different) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<CompareFlagValues> {
    const { flags } = await this.parse(FlowCompare);
    return flags;
  }

  private async writeOutput(result: FlowCompareResult, flags: CompareFlagValues): Promise<void> {
    const rendered = renderFlowComparison(result, flags.format);
    if (flags['output-file'] !== undefined) {
      await writeComparisonReport(flags['output-file'], rendered);
    }
    if (!this.jsonEnabled()) {
      this.log(rendered);
    }
  }
}
