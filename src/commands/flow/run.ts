/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowInvocationFailed } from '../../errors/flow-errors.js';
import { FlowRunService } from '../../services/flow-run-service.js';
import { RestFlowInvocationGateway } from '../../services/rest-flow-invocation-gateway.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowRunRequest, FlowRunResult } from '../../types/flow-invocation.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { readFlowInputs } from '../../utils/flow-input-file.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { writeFlowReport } from '../../utils/flow-report-file.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.run');

export interface RunFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  input: string[];
  'input-file': string | undefined;
  'output-file': string | undefined;
  'dry-run': boolean;
  confirm: boolean;
  'fail-on-flow-error': boolean;
  namespace: string | undefined;
  'api-version': string | undefined;
}

async function createRequest(
  flags: RunFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): Promise<FlowRunRequest> {
  return {
    ...createNamedFlowRequest(flags, context),
    invocations: await readFlowInputs(flags['input-file'], flags.input),
    dryRun: flags['dry-run'],
    confirm: flags.confirm,
  };
}

async function writeResult(outputFile: string, result: FlowRunResult): Promise<void> {
  try {
    await writeFlowReport(outputFile, JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    throw flowInvocationFailed(`Could not write the Flow invocation result to "${outputFile}".`, error);
  }
}

export default class FlowRun extends SfCommand<FlowRunResult> {
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
    input: Flags.string({
      default: [],
      multiple: true,
      exclusive: ['input-file'],
      summary: messages.getMessage('flags.input.summary'),
    }),
    'input-file': Flags.file({
      exists: true,
      exclusive: ['input'],
      summary: messages.getMessage('flags.input-file.summary'),
    }),
    'output-file': Flags.file({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    'dry-run': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.dry-run.summary'),
    }),
    confirm: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.confirm.summary'),
    }),
    'fail-on-flow-error': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.fail-on-flow-error.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowRunResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    return this.execute(flags, context);
  }

  public async parseFlags(): Promise<RunFlagValues> {
    const { flags } = await this.parse(FlowRun);
    return flags;
  }

  private async execute(
    flags: RunFlagValues,
    context: ReturnType<typeof createFlowCommandContext>
  ): Promise<FlowRunResult> {
    const definitionGateway = new ToolingFlowDefinitionGateway(context.connection);
    const service = new FlowRunService({
      definition: definitionGateway,
      invocation: new RestFlowInvocationGateway(context.connection),
    });
    this.warnSideEffects(flags);
    const result = await withFlowProgress(this.spinner, 'run', async (progress) =>
      service.run(await createRequest(flags, context), progress)
    );
    if (flags['output-file'] !== undefined) {
      await writeResult(flags['output-file'], result);
    }
    this.writeHumanOutput(result);
    if (flags['fail-on-flow-error'] && result.successful === false) {
      process.exitCode = 1;
    }
    return result;
  }

  private warnSideEffects(flags: RunFlagValues): void {
    if (!flags['dry-run'] && !this.jsonEnabled()) {
      this.warn(messages.getMessage('warnings.side-effects'));
    }
  }

  private writeHumanOutput(result: FlowRunResult): void {
    this.table({
      title: messages.getMessage('info.title', [qualifiedFlowName(result.apiName, result.namespace), result.version]),
      data: result.invocations.map((invocation, index) => ({
        invocation: index + 1,
        interviewId: invocation.interviewId ?? '',
        outcome: invocation.success === null ? 'Not executed' : invocation.success ? 'Succeeded' : 'Failed',
        executed: invocation.executed,
        outputs: JSON.stringify(invocation.outputs),
        errors: invocation.errors.map((error) => error.message).join('; '),
      })),
      columns: [
        { key: 'invocation', name: 'Invocation' },
        { key: 'interviewId', name: 'Interview ID' },
        { key: 'outcome', name: 'Outcome' },
        { key: 'executed', name: 'Executed' },
        { key: 'outputs', name: 'Outputs' },
        { key: 'errors', name: 'Errors' },
      ],
    });
    if (result.dryRun && !this.jsonEnabled()) {
      this.log(messages.getMessage('info.dry-run'));
    } else if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.request-duration', [result.durationMilliseconds]));
    }
  }
}
