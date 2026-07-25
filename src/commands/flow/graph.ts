/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { writeFile } from 'node:fs/promises';

import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowGraphService } from '../../services/flow-graph-service.js';
import { flowInspectionFailed } from '../../errors/flow-errors.js';
import { flowGraphColorRoleSchema, flowGraphColorSchema } from '../../schemas/flow.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowGraphColorOverrides,
  FlowGraphCurve,
  FlowGraphDirection,
  FlowGraphFormat,
  FlowGraphLayout,
  FlowGraphRequest,
  FlowGraphResult,
  FlowSubflowVersionSelector,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
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
  direction: FlowGraphDirection;
  layout: FlowGraphLayout;
  curve: FlowGraphCurve;
  legend: boolean;
  'label-width': number;
  color: string[];
  'font-family': string;
  'font-size': number;
  'output-file': string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

export function parseGraphColorOverrides(values: ReadonlyArray<string>): FlowGraphColorOverrides {
  return values.reduce<FlowGraphColorOverrides>((colors, value) => {
    const separator = value.indexOf('=');
    const roleResult = flowGraphColorRoleSchema.safeParse(value.slice(0, separator));
    const colorResult = flowGraphColorSchema.safeParse(value.slice(separator + 1).toLowerCase());
    if (separator < 1 || !roleResult.success || !colorResult.success) {
      throw flowInspectionFailed(
        `Graph colour override "${value}" must use a supported ROLE=COLOUR or ROLE=#HEX value.`
      );
    }
    return { ...colors, [roleResult.data]: colorResult.data };
  }, {});
}

export async function writeGraphOutput(outputFile: string | undefined, graph: string): Promise<void> {
  if (outputFile === undefined) {
    return;
  }
  if (outputFile.trim().length === 0) {
    throw flowInspectionFailed('The graph output file path must not be empty.');
  }
  try {
    await writeFile(outputFile, graph, { encoding: 'utf8', flag: 'wx' });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw flowInspectionFailed(`Graph output file "${outputFile}" already exists.`);
    }
    throw flowInspectionFailed(`Failed to write graph output file "${outputFile}".`, error);
  }
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
    direction: flags.direction,
    layout: flags.layout,
    curve: flags.curve,
    legend: flags.legend,
    labelWidth: flags['label-width'],
    style: {
      colors: parseGraphColorOverrides(flags.color),
      fontFamily: flags['font-family'],
      fontSize: flags['font-size'],
    },
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
    direction: Flags.custom<FlowGraphDirection>({
      default: 'auto',
      options: ['auto', 'left-right', 'top-down'],
      summary: messages.getMessage('flags.direction.summary'),
      parse: (input: string): Promise<FlowGraphDirection> => Promise.resolve(input as FlowGraphDirection),
    })(),
    layout: Flags.custom<FlowGraphLayout>({
      default: 'auto',
      options: ['auto', 'dagre', 'elk'],
      summary: messages.getMessage('flags.layout.summary'),
      parse: (input: string): Promise<FlowGraphLayout> => Promise.resolve(input as FlowGraphLayout),
    })(),
    curve: Flags.custom<FlowGraphCurve>({
      default: 'auto',
      options: ['auto', 'basis', 'linear', 'step', 'step-after', 'step-before'],
      summary: messages.getMessage('flags.curve.summary'),
      parse: (input: string): Promise<FlowGraphCurve> => Promise.resolve(input as FlowGraphCurve),
    })(),
    legend: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.legend.summary'),
    }),
    'label-width': Flags.integer({
      default: 32,
      min: 12,
      max: 80,
      summary: messages.getMessage('flags.label-width.summary'),
    }),
    color: Flags.string({
      aliases: ['colour'],
      default: [],
      multiple: true,
      summary: messages.getMessage('flags.color.summary'),
    }),
    'font-family': Flags.string({
      default: 'Arial',
      summary: messages.getMessage('flags.font-family.summary'),
    }),
    'font-size': Flags.integer({
      default: 14,
      min: 8,
      max: 32,
      summary: messages.getMessage('flags.font-size.summary'),
    }),
    'output-file': Flags.string({
      summary: messages.getMessage('flags.output-file.summary'),
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
    const result = await withFlowProgress(this.spinner, 'graph', async (progress) =>
      service.graph(createRequest(flags, context), progress)
    );
    await writeGraphOutput(flags['output-file'], result.graph);
    this.writeHumanOutput(result, flags['output-file']);
    return result;
  }

  public async parseFlags(): Promise<GraphFlagValues> {
    const { flags } = await this.parse(FlowGraph);
    return flags;
  }

  private writeHumanOutput(result: FlowGraphResult, outputFile: string | undefined): void {
    if (this.jsonEnabled()) {
      return;
    }
    this.log(outputFile === undefined ? result.graph : messages.getMessage('info.written', [outputFile]));
    for (const warning of result.warnings) {
      this.warn(messages.getMessage(`warnings.${warning.kind}`, [warning.path.join(' -> ')]));
    }
  }
}
