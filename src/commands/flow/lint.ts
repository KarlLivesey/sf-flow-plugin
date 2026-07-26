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
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type { FlowLintRequest, FlowLintResult } from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.lint');

export interface LintFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: LintFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowLintRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags['flow-version'],
  };
}

export default class FlowLint extends SfCommand<FlowLintResult> {
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
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowLintResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowLintService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'lint', async (progress) =>
      service.lint(createRequest(flags, context), progress)
    );
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<LintFlagValues> {
    const { flags } = await this.parse(FlowLint);
    return flags;
  }

  private writeHumanOutput(result: FlowLintResult): void {
    if (result.findings.length === 0) {
      this.log(messages.getMessage('info.clean', [result.apiName, result.resolvedVersion]));
      return;
    }
    this.table({
      title: messages.getMessage('info.title', [result.apiName, result.resolvedVersion, result.findings.length]),
      data: result.findings.map((finding) => ({
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
