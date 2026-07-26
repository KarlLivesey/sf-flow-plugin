/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowDependenciesService } from '../../services/flow-dependencies-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type {
  FlowDependenciesRequest,
  FlowDependenciesResult,
  FlowDependencyDirection,
} from '../../types/flow-analysis.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
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
  };
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
    this.writeHumanOutput(result);
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

  private writeHumanOutput(result: FlowDependenciesResult): void {
    this.table({
      title: messages.getMessage('info.title', [qualifiedFlowName(result.apiName, result.namespace)]),
      data: result.dependencies.map((dependency) => ({ ...dependency })),
      columns: [
        { key: 'sourceApiName', name: 'Source Flow' },
        { key: 'depth', name: 'Depth' },
        { key: 'direction', name: 'Direction' },
        { key: 'type', name: 'Type' },
        { key: 'namespace', name: 'Namespace' },
        { key: 'name', name: 'Name' },
        { key: 'componentId', name: 'Component ID' },
      ],
    });
    if (!this.jsonEnabled()) {
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
}
