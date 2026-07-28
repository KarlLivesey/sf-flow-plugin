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
import { describeFlowSource } from '../../services/flow-source-analysis-service.js';
import { loadFlowSource } from '../../services/flow-source-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowDescribeRequest,
  FlowDescribeResult,
  FlowDescribeSection,
  FlowDescription,
  FlowSubflowVersionSelector,
  FlowTraversalWarningKind,
  FlowVariableSummary,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { validateFlowSourceFlags } from '../../utils/flow-source-command.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.describe');

const warningMessages: Record<FlowTraversalWarningKind, (path: string) => string> = {
  'depth-limit': (path) => messages.getMessage('warnings.depth-limit', [path]),
  'missing-subflow': (path) => messages.getMessage('warnings.missing-subflow', [path]),
  'missing-subflow-version': (path) => messages.getMessage('warnings.missing-subflow-version', [path]),
  'subflow-version-fallback': (path) => messages.getMessage('warnings.subflow-version-fallback', [path]),
};

export interface DescribeFlagValues {
  'api-name': string | undefined;
  'source-file': string | undefined;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  'subflow-version': FlowSubflowVersionSelector;
  recursive: boolean;
  'max-depth': number;
  only: FlowDescribeSection[] | undefined;
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
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow description.');
  }
  return {
    ...createNamedFlowRequest({ ...flags, 'api-name': flags['api-name'] }, context),
    version: flags['flow-version'],
    subflowVersion: flags['subflow-version'],
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
    sections: flags.only ?? [],
  };
}

function variableName(variable: FlowVariableSummary): string {
  return `${variable.name} (${variable.objectType ?? variable.apexClass ?? variable.dataType})`;
}

function describeRow(flow: FlowDescription): Record<string, number | string> {
  return {
    name: flow.qualifiedName,
    version: flow.versionNumber ?? 'local',
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

function describeColumns(sections: ReadonlyArray<FlowDescribeSection>): Array<{ key: string; name: string }> {
  const all = sections.length === 0;
  const selected = new Set(sections);
  return [
    { key: 'name', name: 'Flow' },
    { key: 'version', name: 'Version' },
    { key: 'status', name: 'Status' },
    ...(all || selected.has('elements') ? [{ key: 'elements', name: 'Elements' }] : []),
    ...(all || selected.has('inputs') ? [{ key: 'inputs', name: 'Inputs' }] : []),
    ...(all || selected.has('outputs') ? [{ key: 'outputs', name: 'Outputs' }] : []),
    ...(all || selected.has('resources')
      ? [
          { key: 'variables', name: 'Variables' },
          { key: 'formulas', name: 'Formulas' },
        ]
      : []),
    ...(all || selected.has('references')
      ? [
          { key: 'apexActions', name: 'Apex' },
          { key: 'subflows', name: 'Subflows' },
          { key: 'objects', name: 'Objects' },
        ]
      : []),
  ];
}

async function describeOrg(
  flags: DescribeFlagValues,
  progress: Parameters<FlowDescribeService['describe']>[1]
): Promise<FlowDescribeResult> {
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow description.');
  }
  validateNamedFlowFlags({ ...flags, 'api-name': flags['api-name'] });
  const context = createFlowCommandContext(flags);
  return new FlowDescribeService(new ToolingFlowDefinitionGateway(context.connection)).describe(
    createRequest(flags, context),
    progress
  );
}

export default class FlowDescribe extends SfCommand<FlowDescribeResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'api-name': Flags.string({
      char: 'n',
      exactlyOne: ['api-name', 'source-file'],
      summary: messages.getMessage('flags.api-name.summary'),
    }),
    'source-file': Flags.file({
      exactlyOne: ['api-name', 'source-file'],
      exists: true,
      summary: messages.getMessage('flags.source-file.summary'),
    }),
    'target-org': Flags.optionalOrg({
      char: 'o',
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'flow-version': Flags.custom<FlowComparisonVersionSelector>({
      default: 'latest',
      summary: messages.getMessage('flags.flow-version.summary'),
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
    only: Flags.custom<FlowDescribeSection>({
      multiple: true,
      options: ['elements', 'resources', 'references', 'inputs', 'outputs'],
      summary: messages.getMessage('flags.only.summary'),
    })(),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowDescribeResult> {
    validateFlowSourceFlags(this.argv, [
      'target-org',
      'flow-version',
      'subflow-version',
      'recursive',
      'max-depth',
      'namespace',
      'api-version',
    ]);
    const flags = await this.parseFlags();
    const result = await withFlowProgress(this.spinner, 'describe', async (progress) =>
      flags['source-file'] === undefined
        ? describeOrg(flags, progress)
        : (progress('loading-source', flags['source-file']),
          describeFlowSource(await loadFlowSource(flags['source-file']), flags.only ?? []))
    );
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
      columns: describeColumns(result.sections),
    });
    if (!this.jsonEnabled()) {
      for (const warning of result.warnings) {
        this.warn(warningMessages[warning.kind](warning.path.join(' -> ')));
      }
    }
  }
}
