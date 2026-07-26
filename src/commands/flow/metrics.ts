/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowMetricsFailed } from '../../errors/flow-errors.js';
import { DataCloudFlowMetricsGateway } from '../../services/data-cloud-flow-metrics-gateway.js';
import { FlowMetricsService } from '../../services/flow-metrics-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type { FlowSubflowVersionSelector } from '../../types/flow-inspection.js';
import type { FlowMetricsCommandResult, FlowMetricsRequest } from '../../types/flow-metrics.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReportFile } from '../../utils/flow-report-file.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.metrics');

export interface MetricsFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  recursive: boolean;
  'subflow-version': FlowSubflowVersionSelector;
  'max-depth': number;
  'data-cloud': boolean;
  'data-cloud-days': number;
  'output-file': string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(
  flags: MetricsFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowMetricsRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags['flow-version'],
    recursive: flags.recursive,
    subflowVersion: flags['subflow-version'],
    maxDepth: flags['max-depth'],
    dataCloud: flags['data-cloud'],
    dataCloudDays: flags['data-cloud-days'],
  };
}

export default class FlowMetrics extends SfCommand<FlowMetricsCommandResult> {
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
    'flow-version': Flags.custom<FlowComparisonVersionSelector>({
      default: 'latest',
      summary: messages.getMessage('flags.flow-version.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseInspectionVersionSelector(input)),
    })(),
    recursive: Flags.boolean({
      char: 'r',
      default: false,
      summary: messages.getMessage('flags.recursive.summary'),
    }),
    'subflow-version': Flags.custom<FlowSubflowVersionSelector>({
      default: 'active',
      options: ['active', 'latest'],
      summary: messages.getMessage('flags.subflow-version.summary'),
    })(),
    'max-depth': Flags.integer({
      default: 10,
      min: 0,
      summary: messages.getMessage('flags.max-depth.summary'),
    }),
    'data-cloud': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.data-cloud.summary'),
    }),
    'data-cloud-days': Flags.integer({
      default: 30,
      min: 1,
      summary: messages.getMessage('flags.data-cloud-days.summary'),
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

  public async run(): Promise<FlowMetricsCommandResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const result = await withFlowProgress(this.spinner, 'metrics', async (progress) =>
      new FlowMetricsService(
        new ToolingFlowDefinitionGateway(context.connection),
        flags['data-cloud'] ? new DataCloudFlowMetricsGateway(context.connection) : undefined
      ).calculate(createRequest(flags, context), progress)
    );
    await this.writeOutput(result, flags['output-file']);
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<MetricsFlagValues> {
    const { flags } = await this.parse(FlowMetrics);
    return flags;
  }

  private async writeOutput(result: FlowMetricsCommandResult, outputFile: string | undefined): Promise<void> {
    if (outputFile !== undefined) {
      const file = await writeFlowReportFile(outputFile, JSON.stringify(result, null, 2), flowMetricsFailed);
      if (!this.jsonEnabled()) {
        this.log(messages.getMessage('info.wrote-output', [file]));
      }
    }
  }

  private writeHumanOutput(result: FlowMetricsCommandResult): void {
    this.table({
      title: messages.getMessage('info.title', [result.apiName, result.resolvedVersion]),
      data: result.flows.map((flow) => ({
        ...flow,
        faultPathCoverage: flow.faultPathCoverage === null ? '-' : `${Math.round(flow.faultPathCoverage * 100)}%`,
        referencedObjects: flow.referencedObjects.join(', '),
      })),
      columns: [
        { key: 'apiName', name: 'Flow' },
        { key: 'version', name: 'Version' },
        { key: 'executableElements', name: 'Elements' },
        { key: 'decisions', name: 'Decisions' },
        { key: 'loops', name: 'Loops' },
        { key: 'dmlElements', name: 'DML' },
        { key: 'dmlInsideLoops', name: 'DML in loops' },
        { key: 'maximumPathDepthUpperBound', name: 'Path depth upper bound' },
        { key: 'faultPathCoverage', name: 'Fault coverage' },
        { key: 'unreachableElements', name: 'Unreachable' },
        { key: 'referencedObjects', name: 'Objects' },
      ],
    });
    this.writeDataCloudOutput(result);
  }

  private writeDataCloudOutput(result: FlowMetricsCommandResult): void {
    if (result.dataCloud === null || this.jsonEnabled()) {
      return;
    }
    const runtime = result.dataCloud;
    this.table({
      title: messages.getMessage('info.data-cloud-title', [runtime.windowDays]),
      data: [
        {
          executions: runtime.executions,
          successful: runtime.successfulExecutions,
          failed: runtime.failedExecutions,
          averageDuration: runtime.averageDurationMilliseconds ?? '-',
          minimumDuration: runtime.minimumDurationMilliseconds ?? '-',
          maximumDuration: runtime.maximumDurationMilliseconds ?? '-',
          firstExecution: runtime.firstExecution ?? '-',
          lastExecution: runtime.lastExecution ?? '-',
        },
      ],
      columns: [
        { key: 'executions', name: 'Executions' },
        { key: 'successful', name: 'Successful' },
        { key: 'failed', name: 'Failed' },
        { key: 'averageDuration', name: 'Average (ms)' },
        { key: 'minimumDuration', name: 'Minimum (ms)' },
        { key: 'maximumDuration', name: 'Maximum (ms)' },
        { key: 'firstExecution', name: 'First execution' },
        { key: 'lastExecution', name: 'Last execution' },
      ],
    });
  }
}
