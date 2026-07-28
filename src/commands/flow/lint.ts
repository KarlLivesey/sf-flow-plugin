/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowLintService } from '../../services/flow-lint-service.js';
import { lintFlowSource } from '../../services/flow-source-analysis-service.js';
import { loadFlowSource } from '../../services/flow-source-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowLintFailSeverity,
  FlowLintRequest,
  FlowLintResult,
  FlowLintResultFormat,
  FlowLintRule,
} from '../../types/flow-lint.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import {
  applyFlowLintBaseline,
  formatFlowLintHuman,
  formatFlowLintSarif,
  writeFlowLintOutput,
} from '../../utils/flow-lint-output.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';
import { validateFlowSourceFlags } from '../../utils/flow-source-command.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.lint');

export interface LintFlagValues {
  'api-name': string | undefined;
  'source-file': string | undefined;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  'fail-on': FlowLintFailSeverity | undefined;
  rule: FlowLintRule[] | undefined;
  'exclude-rule': FlowLintRule[] | undefined;
  'result-format': FlowLintResultFormat;
  'output-file': string | undefined;
  baseline: string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: LintFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowLintRequest {
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow linting.');
  }
  return {
    ...createNamedFlowRequest({ ...flags, 'api-name': flags['api-name'] }, context),
    version: flags['flow-version'],
    rules: flags.rule ?? [],
    excludedRules: flags['exclude-rule'] ?? [],
  };
}

const lintRules: FlowLintRule[] = [
  'dml-inside-loop',
  'hard-coded-id',
  'inactive-subflow',
  'missing-fault-path',
  'missing-subflow',
  'unconnected-element',
  'unused-resource',
];

function shouldFail(result: FlowLintResult, severity: FlowLintFailSeverity | undefined): boolean {
  return severity === 'warning'
    ? result.newErrors + result.newWarnings > 0
    : severity === 'error' && result.newErrors > 0;
}

async function lintOrg(
  flags: LintFlagValues,
  progress: Parameters<FlowLintService['lint']>[1]
): Promise<FlowLintResult> {
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow linting.');
  }
  validateNamedFlowFlags({ ...flags, 'api-name': flags['api-name'] });
  const context = createFlowCommandContext(flags);
  return new FlowLintService(new ToolingFlowDefinitionGateway(context.connection)).lint(
    createRequest(flags, context),
    progress
  );
}

export default class FlowLint extends SfCommand<FlowLintResult> {
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
    'fail-on': Flags.custom<FlowLintFailSeverity>({
      options: ['warning', 'error'],
      summary: messages.getMessage('flags.fail-on.summary'),
    })(),
    rule: Flags.custom<FlowLintRule>({
      multiple: true,
      options: lintRules,
      summary: messages.getMessage('flags.rule.summary'),
    })(),
    'exclude-rule': Flags.custom<FlowLintRule>({
      multiple: true,
      options: lintRules,
      summary: messages.getMessage('flags.exclude-rule.summary'),
    })(),
    'result-format': Flags.custom<FlowLintResultFormat>({
      default: 'human',
      options: ['human', 'sarif'],
      summary: messages.getMessage('flags.result-format.summary'),
    })(),
    'output-file': Flags.string({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    baseline: Flags.string({
      summary: messages.getMessage('flags.baseline.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowLintResult> {
    validateFlowSourceFlags(this.argv, ['target-org', 'flow-version', 'namespace', 'api-version']);
    const flags = await this.parseFlags();
    const lintResult = await withFlowProgress(this.spinner, 'lint', async (progress) =>
      flags['source-file'] === undefined
        ? lintOrg(flags, progress)
        : (progress('loading-source', flags['source-file']),
          lintFlowSource(
            await loadFlowSource(flags['source-file']),
            { rules: flags.rule ?? [], excludedRules: flags['exclude-rule'] ?? [] },
            progress
          ))
    );
    const result = await applyFlowLintBaseline(lintResult, flags.baseline);
    await this.writeOutput(result, flags);
    if (shouldFail(result, flags['fail-on'])) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<LintFlagValues> {
    const { flags } = await this.parse(FlowLint);
    return flags;
  }

  private async writeOutput(result: FlowLintResult, flags: LintFlagValues): Promise<void> {
    const content = flags['result-format'] === 'sarif' ? formatFlowLintSarif(result) : formatFlowLintHuman(result);
    if (flags['output-file'] !== undefined) {
      const file = await writeFlowLintOutput(flags['output-file'], content);
      if (!this.jsonEnabled()) {
        this.log(messages.getMessage('info.wrote-output', [file]));
      }
    }
    if (flags['result-format'] === 'sarif' && flags['output-file'] === undefined && !this.jsonEnabled()) {
      this.log(content);
      return;
    }
    if (flags['result-format'] === 'human') {
      this.writeHumanOutput(result);
    }
  }

  private writeHumanOutput(result: FlowLintResult): void {
    const flowName = qualifiedFlowName(result.apiName, result.namespace);
    const version = result.resolvedVersion === null ? 'local source' : `v${result.resolvedVersion}`;
    if (result.findings.length === 0) {
      this.log(messages.getMessage('info.clean', [flowName, version]));
      return;
    }
    this.writeFindingTable(
      messages.getMessage('info.new-title', [flowName, version, result.newFindings.length]),
      result.newFindings
    );
    if (result.baselineFindings.length > 0) {
      this.writeFindingTable(
        messages.getMessage('info.baseline-title', [result.baselineFindings.length]),
        result.baselineFindings
      );
    }
  }

  private writeFindingTable(title: string, findings: FlowLintResult['findings']): void {
    this.table({
      title,
      data: findings.map((finding) => ({
        ...finding,
        element: finding.element ?? '-',
        path: finding.path ?? '-',
      })),
      columns: [
        { key: 'severity', name: 'Severity' },
        { key: 'rule', name: 'Rule' },
        { key: 'element', name: 'Element' },
        { key: 'path', name: 'Metadata Path' },
        { key: 'message', name: 'Message' },
      ],
    });
  }
}
