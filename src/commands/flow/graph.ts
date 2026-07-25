/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowGraphService } from '../../services/flow-graph-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowGraphFormat,
  FlowGraphRequest,
  FlowGraphResult,
  FlowSubflowVersionSelector,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.graph');

export interface GraphFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  version: FlowComparisonVersionSelector;
  'subflow-version': FlowSubflowVersionSelector;
  format: FlowGraphFormat;
  recursive: boolean;
  'max-depth': number;
  'include-variables': boolean;
  'include-formulas': boolean;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: GraphFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowGraphRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags.version,
    subflowVersion: flags['subflow-version'],
    format: flags.format,
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
    includeVariables: flags['include-variables'],
    includeFormulas: flags['include-formulas'],
  };
}

export default class FlowGraph extends SfCommand<FlowGraphResult> {
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
    version: Flags.custom<FlowComparisonVersionSelector>({
      char: 'v',
      default: 'latest',
      summary: messages.getMessage('flags.version.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseInspectionVersionSelector(input)),
    })(),
    'subflow-version': Flags.custom<FlowSubflowVersionSelector>({
      default: 'active',
      options: ['active', 'latest'],
      summary: messages.getMessage('flags.subflow-version.summary'),
      parse: (input: string): Promise<FlowSubflowVersionSelector> =>
        Promise.resolve(input === 'latest' ? 'latest' : 'active'),
    })(),
    format: Flags.custom<FlowGraphFormat>({
      char: 'f',
      default: 'mermaid',
      options: ['mermaid', 'dot'],
      summary: messages.getMessage('flags.format.summary'),
      parse: (input: string): Promise<FlowGraphFormat> => Promise.resolve(input === 'dot' ? 'dot' : 'mermaid'),
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
    'include-variables': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.include-variables.summary'),
    }),
    'include-formulas': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.include-formulas.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowGraphResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowGraphService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await service.graph(createRequest(flags, context));
    if (!this.jsonEnabled()) {
      this.log(result.graph);
      for (const warning of result.warnings) {
        this.warn(messages.getMessage(`warnings.${warning.kind}`, [warning.path.join(' -> ')]));
      }
    }
    return result;
  }

  public async parseFlags(): Promise<GraphFlagValues> {
    const { flags } = await this.parse(FlowGraph);
    return flags;
  }
}
