/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowInspectionFailed } from '../../errors/flow-errors.js';
import { FlowDescribeService } from '../../services/flow-describe-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowDescribeRequest,
  FlowDescribeResult,
  FlowDescription,
  FlowSubflowVersionSelector,
  FlowVariableSummary,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.describe');

export interface DescribeFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  version: FlowComparisonVersionSelector;
  'subflow-version': FlowSubflowVersionSelector;
  recursive: boolean;
  'max-depth': number;
  namespace: string | undefined;
  'api-version': string | undefined;
}

export function parseInspectionVersionSelector(input: string): FlowComparisonVersionSelector {
  if (input === 'active' || input === 'latest') {
    return input;
  }
  if (!/^[1-9]\d*$/.test(input) || !Number.isSafeInteger(Number(input))) {
    throw flowInspectionFailed(`Flow inspection version "${input}" is invalid.`);
  }
  return Number(input);
}

function createRequest(
  flags: DescribeFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowDescribeRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags.version,
    subflowVersion: flags['subflow-version'],
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
  };
}

function variableName(variable: FlowVariableSummary): string {
  return `${variable.name} (${variable.objectType ?? variable.apexClass ?? variable.dataType})`;
}

function describeRow(flow: FlowDescription): Record<string, number | string> {
  return {
    name: flow.qualifiedName,
    version: flow.versionNumber,
    status: flow.status,
    elements: flow.elements.map((element) => `${element.type}: ${element.label ?? element.name}`).join(', '),
    inputs: flow.variables
      .filter((variable) => variable.input)
      .map(variableName)
      .join(', '),
    outputs: flow.variables
      .filter((variable) => variable.output)
      .map(variableName)
      .join(', '),
    variables: flow.variables.map(variableName).join(', '),
    formulas: flow.formulas.map((formula) => formula.name).join(', '),
    apexActions: flow.apexActions.map((action) => action.actionName ?? action.name).join(', '),
    subflows: flow.subflows.map((subflow) => subflow.flowName).join(', '),
    objects: flow.referencedObjects.join(', '),
  };
}

export default class FlowDescribe extends SfCommand<FlowDescribeResult> {
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
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowDescribeResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowDescribeService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await service.describe(createRequest(flags, context));
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<DescribeFlagValues> {
    const { flags } = await this.parse(FlowDescribe);
    return flags;
  }

  private writeHumanOutput(result: FlowDescribeResult): void {
    this.table({
      title: messages.getMessage('info.title'),
      data: result.flows.map(describeRow),
      columns: [
        { key: 'name', name: 'Flow' },
        { key: 'version', name: 'Version' },
        { key: 'status', name: 'Status' },
        { key: 'elements', name: 'Elements' },
        { key: 'inputs', name: 'Inputs' },
        { key: 'outputs', name: 'Outputs' },
        { key: 'variables', name: 'Variables' },
        { key: 'formulas', name: 'Formulas' },
        { key: 'apexActions', name: 'Apex' },
        { key: 'subflows', name: 'Subflows' },
        { key: 'objects', name: 'Objects' },
      ],
    });
    if (!this.jsonEnabled()) {
      for (const warning of result.warnings) {
        this.warn(messages.getMessage(`warnings.${warning.kind}`, [warning.path.join(' -> ')]));
      }
    }
  }
}
