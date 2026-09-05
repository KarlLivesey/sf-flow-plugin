/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowDependenciesFailed } from '../../errors/flow-errors.js';
import { FlowDependenciesService } from '../../services/flow-dependencies-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowDependenciesRequest,
  FlowDependenciesResult,
  FlowDependencyDirection,
  FlowDependencyFormat,
} from '../../types/flow-analysis.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { renderFlowDependencies } from '../../utils/flow-dependencies-renderer.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReport } from '../../utils/flow-report-file.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.dependencies');

export interface DependenciesFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  direction: FlowDependencyDirection;
  recursive: boolean;
  'max-depth': number;
  type: string[] | undefined;
  'exclude-type': string[] | undefined;
  format: FlowDependencyFormat;
  'output-file': string | undefined;
  'fail-on-dependencies': boolean;
  'allow-truncated': boolean;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(
  flags: DependenciesFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowDependenciesRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    direction: flags.direction,
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
    types: flags.type ?? [],
    excludeTypes: flags['exclude-type'] ?? [],
  };
}

async function writeDependenciesReport(outputFile: string, content: string): Promise<void> {
  try {
    await writeFlowReport(outputFile, content);
  } catch (error: unknown) {
    throw flowDependenciesFailed(`Could not write the Flow dependencies to "${outputFile}".`, error);
  }
}

export default class FlowDependencies extends SfCommand<FlowDependenciesResult> {
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
    direction: Flags.custom<FlowDependencyDirection>({
      char: 'd',
      default: 'both',
      options: ['uses', 'used-by', 'both'],
      summary: messages.getMessage('flags.direction.summary'),
      parse: (input: string): Promise<FlowDependencyDirection> =>
        Promise.resolve(input === 'uses' || input === 'used-by' ? input : 'both'),
    })(),
    recursive: Flags.boolean({
      char: 'r',
      default: false,
      summary: messages.getMessage('flags.recursive.summary'),
    }),
    'max-depth': Flags.integer({
      default: 10,
      min: 0,
      summary: messages.getMessage('flags.max-depth.summary'),
    }),
    type: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.type.summary'),
    }),
    'exclude-type': Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.exclude-type.summary'),
    }),
    format: Flags.custom<FlowDependencyFormat>({
      default: 'table',
      options: ['table', 'tree', 'mermaid', 'dot'],
      summary: messages.getMessage('flags.format.summary'),
    })(),
    'output-file': Flags.file({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    'fail-on-dependencies': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.fail-on-dependencies.summary'),
    }),
    'allow-truncated': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.allow-truncated.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowDependenciesResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowDependenciesService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'dependencies', async (progress) =>
      service.getDependencies(createRequest(flags, context), progress)
    );
    await this.writeOutput(result, flags);
    if (
      (flags['fail-on-dependencies'] && result.dependencies.length > 0) ||
      (!flags['allow-truncated'] && result.truncated)
    ) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<DependenciesFlagValues> {
    const { flags } = await this.parse(FlowDependencies);
    return flags;
  }

  private async writeOutput(result: FlowDependenciesResult, flags: DependenciesFlagValues): Promise<void> {
    const rendered = renderFlowDependencies(result, flags.format);
    if (flags['output-file'] !== undefined) {
      await writeDependenciesReport(flags['output-file'], rendered);
    }
    if (flags.format === 'table') {
      this.writeHumanOutput(result);
    } else if (!this.jsonEnabled()) {
      this.log(rendered);
      this.writeTruncationWarnings(result);
    }
  }

  private writeHumanOutput(result: FlowDependenciesResult): void {
    this.table({
      title: messages.getMessage('info.title', [qualifiedFlowName(result.apiName, result.namespace)]),
      data: result.dependencies.map((dependency) => ({
        ...dependency,
        sourceFlow: qualifiedFlowName(dependency.sourceApiName, dependency.sourceNamespace),
      })),
      columns: [
        { key: 'sourceFlow', name: 'Source Flow' },
        { key: 'depth', name: 'Depth' },
        { key: 'direction', name: 'Direction' },
        { key: 'type', name: 'Type' },
        { key: 'namespace', name: 'Namespace' },
        { key: 'name', name: 'Name' },
        { key: 'componentId', name: 'Component ID' },
      ],
    });
    this.writeTruncationWarnings(result);
  }

  private writeTruncationWarnings(result: FlowDependenciesResult): void {
    if (this.jsonEnabled()) {
      return;
    }
    for (const truncation of result.truncations) {
      this.warn(
        messages.getMessage('warnings.truncated', [
          qualifiedFlowName(truncation.apiName, truncation.namespace),
          truncation.direction,
          truncation.depth,
          truncation.limit,
        ])
      );
    }
  }
}
