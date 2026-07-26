/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowCheckFailed } from '../../errors/flow-errors.js';
import { FlowCheckService } from '../../services/flow-check-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowCheckKind,
  FlowCheckRequest,
  FlowCheckResult,
  FlowCheckResultFormat,
  FlowCheckSeverity,
} from '../../types/flow-check.js';
import type { FlowSubflowVersionSelector } from '../../types/flow-inspection.js';
import { FLOW_CHECK_KINDS, formatFlowCheckHuman, formatFlowCheckSarif } from '../../utils/flow-check-analysis.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { validateFlowApiName, validateNamespace } from '../../utils/flow-name-validation.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReportFile } from '../../utils/flow-report-file.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.check');

export interface CheckFlagValues {
  'api-name': string[];
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  only: FlowCheckKind[] | undefined;
  exclude: FlowCheckKind[] | undefined;
  recursive: boolean;
  'subflow-version': FlowSubflowVersionSelector;
  'max-depth': number;
  'allow-truncated': boolean;
  'fail-on': FlowCheckSeverity;
  'result-format': FlowCheckResultFormat;
  'output-file': string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: CheckFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowCheckRequest {
  flags['api-name'].forEach(validateFlowApiName);
  if (flags.namespace !== undefined) {
    validateNamespace(flags.namespace);
  }
  return {
    apiNames: [...new Set(flags['api-name'])],
    targetOrg: context.targetOrg,
    version: flags['flow-version'],
    subflowVersion: flags['subflow-version'],
    checks: flags.only ?? [],
    excludedChecks: flags.exclude ?? [],
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
    allowTruncated: flags['allow-truncated'],
    ...(flags.namespace === undefined ? {} : { namespace: flags.namespace }),
    ...(flags['api-version'] === undefined ? {} : { apiVersion: flags['api-version'] }),
  };
}

function shouldFail(result: FlowCheckResult, severity: FlowCheckSeverity): boolean {
  return severity === 'warning' ? result.errors + result.warnings > 0 : result.errors > 0;
}

export default class FlowCheck extends SfCommand<FlowCheckResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'api-name': Flags.string({
      char: 'n',
      multiple: true,
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
    only: Flags.custom<FlowCheckKind>({
      multiple: true,
      options: FLOW_CHECK_KINDS,
      summary: messages.getMessage('flags.only.summary'),
    })(),
    exclude: Flags.custom<FlowCheckKind>({
      multiple: true,
      options: FLOW_CHECK_KINDS,
      summary: messages.getMessage('flags.exclude.summary'),
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
    'allow-truncated': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.allow-truncated.summary'),
    }),
    'fail-on': Flags.custom<FlowCheckSeverity>({
      default: 'error',
      options: ['warning', 'error'],
      summary: messages.getMessage('flags.fail-on.summary'),
    })(),
    'result-format': Flags.custom<FlowCheckResultFormat>({
      default: 'human',
      options: ['human', 'sarif'],
      summary: messages.getMessage('flags.result-format.summary'),
    })(),
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

  public async run(): Promise<FlowCheckResult> {
    const flags = await this.parseFlags();
    const context = createFlowCommandContext(flags);
    const result = await withFlowProgress(this.spinner, 'check', async (progress) =>
      new FlowCheckService(new ToolingFlowDefinitionGateway(context.connection)).check(
        createRequest(flags, context),
        progress
      )
    );
    await this.writeOutput(result, flags);
    if (shouldFail(result, flags['fail-on'])) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<CheckFlagValues> {
    const { flags } = await this.parse(FlowCheck);
    return flags;
  }

  private async writeOutput(result: FlowCheckResult, flags: CheckFlagValues): Promise<void> {
    const content = flags['result-format'] === 'sarif' ? formatFlowCheckSarif(result) : formatFlowCheckHuman(result);
    if (flags['output-file'] !== undefined) {
      const file = await writeFlowReportFile(flags['output-file'], content, flowCheckFailed);
      if (!this.jsonEnabled()) {
        this.log(messages.getMessage('info.wrote-output', [file]));
      }
    }
    if (flags['result-format'] === 'sarif' && flags['output-file'] === undefined && !this.jsonEnabled()) {
      this.log(content);
    } else if (flags['result-format'] === 'human') {
      this.writeHumanOutput(result);
    }
  }

  private writeHumanOutput(result: FlowCheckResult): void {
    this.table({
      title: messages.getMessage('info.title', [result.errors, result.warnings]),
      data: result.findings.map((finding) => ({
        ...finding,
        apiName: qualifiedFlowName(finding.apiName, finding.namespace),
        version: finding.version ?? '-',
        path: finding.path ?? '-',
      })),
      columns: [
        { key: 'severity', name: 'Severity' },
        { key: 'apiName', name: 'Flow' },
        { key: 'version', name: 'Version' },
        { key: 'check', name: 'Check' },
        { key: 'code', name: 'Code' },
        { key: 'path', name: 'Path' },
        { key: 'message', name: 'Message' },
      ],
    });
  }
}
