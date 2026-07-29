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
import { loadFlowSource } from '../../services/flow-source-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowCompareRequest,
  FlowCompareResult,
  FlowComparisonFormat,
  FlowComparisonScope,
  FlowComparisonVersionSelector,
} from '../../types/flow-analysis.js';
import type { FlowSource } from '../../types/flow-source.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { validateFlowApiName, validateNamespace } from '../../utils/flow-name-validation.js';
import { renderFlowComparison } from '../../utils/flow-comparison-renderer.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReport } from '../../utils/flow-report-file.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.compare');

export interface CompareFlagValues {
  'api-name': string | undefined;
  'from-file': string | undefined;
  'to-file': string | undefined;
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
  from?: ReturnType<typeof createFlowCommandContext>;
  to?: ReturnType<typeof createFlowCommandContext>;
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

function comparisonFlagProvided(
  argv: ReadonlyArray<string>,
  flag: string,
  aliases: ReadonlyArray<string> = []
): boolean {
  return argv.some((argument) =>
    [`--${flag}`, ...aliases].some((name) => argument === name || argument.startsWith(`${name}=`))
  );
}

export function validateLocalFileComparisonFlags(argv: ReadonlyArray<string>): void {
  if (!comparisonFlagProvided(argv, 'from-file') || !comparisonFlagProvided(argv, 'to-file')) {
    return;
  }
  const unsupported = [
    ['target-org', ['-o']],
    ['from-org', []],
    ['to-org', []],
    ['api-version', []],
  ] as const;
  const provided = unsupported
    .filter(([flag, aliases]) => comparisonFlagProvided(argv, flag, aliases))
    .map(([flag]) => `--${flag}`);
  if (provided.length > 0) {
    throw flowComparisonFailed(`Two local Flow files cannot be combined with ${provided.join(', ')}.`);
  }
}

function createRequest(
  flags: CompareFlagValues,
  contexts: ComparisonContexts,
  sources: { from?: FlowSource; to?: FlowSource }
): FlowCompareRequest {
  const { apiName, namespace } = comparisonIdentity(flags, sources);
  const fromOrg = contexts.from?.targetOrg ?? 'local source';
  const toOrg = contexts.to?.targetOrg ?? 'local source';
  return {
    apiName,
    targetOrg: fromOrg,
    ...(namespace === undefined ? {} : { namespace }),
    ...(flags['api-version'] === undefined ? {} : { apiVersion: flags['api-version'] }),
    from: flags.from,
    to: flags.to,
    fromOrg,
    toOrg,
    scopes: flags.only ?? [],
    ignoreOrder: flags['ignore-order'],
    ignorePaths: flags['ignore-path'] ?? [],
  };
}

function comparisonIdentity(
  flags: CompareFlagValues,
  sources: { from?: FlowSource; to?: FlowSource }
): { apiName: string; namespace: string | undefined } {
  const identity = sources.from ?? sources.to;
  const apiName = flags['api-name'] ?? identity?.apiName;
  if (apiName === undefined) {
    throw flowComparisonFailed('--api-name is required when neither comparison side is a local source file.');
  }
  validateFlowApiName(apiName);
  const namespace = flags.namespace ?? identity?.namespace ?? undefined;
  if (namespace !== undefined) {
    validateNamespace(namespace);
  }
  return { apiName, namespace };
}

function createComparisonContexts(flags: CompareFlagValues): ComparisonContexts {
  if (flags['from-org'] !== undefined && flags['to-org'] !== undefined) {
    return {
      from: createFlowCommandContext({ 'target-org': flags['from-org'], 'api-version': flags['api-version'] }),
      to: createFlowCommandContext({ 'target-org': flags['to-org'], 'api-version': flags['api-version'] }),
    };
  }
  if (flags['from-file'] !== undefined && flags['to-file'] !== undefined) {
    return {};
  }
  const context = createFlowCommandContext(flags);
  return {
    ...(flags['from-file'] === undefined ? { from: context } : {}),
    ...(flags['to-file'] === undefined ? { to: context } : {}),
  };
}

async function loadComparisonSources(flags: CompareFlagValues): Promise<{ from?: FlowSource; to?: FlowSource }> {
  const from = flags['from-file'] === undefined ? undefined : await loadFlowSource(flags['from-file']);
  const to = flags['to-file'] === undefined ? undefined : await loadFlowSource(flags['to-file']);
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

function createComparisonService(contexts: ComparisonContexts): FlowComparisonService {
  const fromGateway =
    contexts.from === undefined ? undefined : new ToolingFlowDefinitionGateway(contexts.from.connection);
  const toGateway =
    contexts.to === undefined
      ? undefined
      : contexts.to === contexts.from
      ? fromGateway
      : new ToolingFlowDefinitionGateway(contexts.to.connection);
  return fromGateway === toGateway
    ? new FlowComparisonService(fromGateway)
    : new FlowComparisonService(fromGateway, toGateway);
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
      summary: messages.getMessage('flags.api-name.summary'),
    }),
    'from-file': Flags.file({
      exists: true,
      exclusive: ['from', 'from-org'],
      summary: messages.getMessage('flags.from-file.summary'),
    }),
    'to-file': Flags.file({
      exists: true,
      exclusive: ['to', 'to-org'],
      summary: messages.getMessage('flags.to-file.summary'),
    }),
    'target-org': Flags.optionalOrg({
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
    const sources = await loadComparisonSources(flags);
    const contexts = createComparisonContexts(flags);
    const service = createComparisonService(contexts);
    const result = await withFlowProgress(this.spinner, 'compare', async (progress) =>
      service.compare(createRequest(flags, contexts, sources), progress, sources)
    );
    await this.writeOutput(result, flags);
    if (flags['fail-on-difference'] && result.different) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<CompareFlagValues> {
    validateLocalFileComparisonFlags(this.argv);
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
