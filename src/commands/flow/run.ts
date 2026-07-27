/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowDebugFailed, flowInputInvalid, flowInvocationFailed } from '../../errors/flow-errors.js';
import { FlowDebugService } from '../../services/flow-debug-service.js';
import { FlowRunService } from '../../services/flow-run-service.js';
import { RestFlowInvocationGateway } from '../../services/rest-flow-invocation-gateway.js';
import { ToolingFlowDebugGateway } from '../../services/tooling-flow-debug-gateway.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowDebugArtifact, FlowDebugLogLevel } from '../../types/flow-debug.js';
import type { FlowRollbackRequest, FlowRunRequest, FlowRunResult } from '../../types/flow-invocation.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { readFlowInputs } from '../../utils/flow-input-file.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { validateFlowReportDestination, writeFlowReport } from '../../utils/flow-report-file.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.run');

export interface RunFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  input: string[];
  'input-file': string | undefined;
  'output-file': string | undefined;
  'raw-log-file': string | undefined;
  'dry-run': boolean;
  rollback: boolean;
  confirm: boolean;
  'log-level': FlowDebugLogLevel | undefined;
  'show-values': boolean | undefined;
  wait: number | undefined;
  'fail-on-flow-error': boolean;
  namespace: string | undefined;
  'api-version': string | undefined;
}

async function createRunRequest(
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

async function createRollbackRequest(
  flags: RunFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): Promise<FlowRollbackRequest> {
  const inputs = await readFlowInputs(flags['input-file'], flags.input);
  const input = inputs[0];
  const waitMinutes = flags.wait ?? 2;
  if (inputs.length !== 1 || input === undefined) {
    throw flowInputInvalid(`Flow rollback accepts exactly one input object; received ${inputs.length}.`);
  }
  if (waitMinutes < 1 || waitMinutes > 10) {
    throw flowInputInvalid(`Flow rollback log wait must be between 1 and 10 minutes; received ${waitMinutes}.`);
  }
  return {
    ...createNamedFlowRequest(flags, context),
    input,
    dryRun: flags['dry-run'],
    confirm: flags.confirm,
    logLevel: flags['log-level'] ?? 'detailed',
    showValues: flags['show-values'] ?? false,
    waitMilliseconds: waitMinutes * 60_000,
  };
}

async function writeResult(outputFile: string, result: FlowRunResult): Promise<void> {
  try {
    await writeFlowReport(outputFile, JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    throw flowInvocationFailed(`Could not write the Flow invocation result to "${outputFile}".`, error);
  }
}

async function writeRawLog(outputFile: string, rawLog: string): Promise<void> {
  try {
    await writeFlowReport(outputFile, rawLog);
  } catch (error: unknown) {
    throw flowDebugFailed(`Could not write the raw Salesforce debug log to "${outputFile}".`, error);
  }
}

async function validateRawLogDestination(outputFile: string): Promise<void> {
  try {
    await validateFlowReportDestination(outputFile);
  } catch (error: unknown) {
    throw flowDebugFailed(`Could not use "${outputFile}" as the raw Salesforce debug-log destination.`, error);
  }
}

async function persistArtifact(flags: RunFlagValues, artifact: FlowDebugArtifact<FlowRunResult>): Promise<void> {
  if (flags['output-file'] !== undefined) {
    await writeResult(flags['output-file'], artifact.result);
  }
  const rawLogFile = flags['raw-log-file'];
  if (rawLogFile !== undefined) {
    await (artifact.result.dryRun ? validateRawLogDestination(rawLogFile) : writeRawLog(rawLogFile, artifact.rawLog));
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
    'raw-log-file': Flags.file({
      relationships: [{ type: 'some', flags: ['rollback'] }],
      summary: messages.getMessage('flags.raw-log-file.summary'),
    }),
    'dry-run': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.dry-run.summary'),
    }),
    rollback: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.rollback.summary'),
    }),
    confirm: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.confirm.summary'),
    }),
    'log-level': Flags.custom<FlowDebugLogLevel>({
      options: ['basic', 'detailed', 'finest'],
      relationships: [{ type: 'some', flags: ['rollback'] }],
      summary: messages.getMessage('flags.log-level.summary'),
    })(),
    'show-values': Flags.boolean({
      relationships: [{ type: 'some', flags: ['rollback'] }],
      summary: messages.getMessage('flags.show-values.summary'),
    }),
    wait: Flags.integer({
      relationships: [{ type: 'some', flags: ['rollback'] }],
      summary: messages.getMessage('flags.wait.summary'),
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
    this.warnSideEffects(flags);
    const artifact = flags.rollback
      ? await withFlowProgress(this.spinner, 'run', async (progress) =>
          new FlowDebugService({
            definition: definitionGateway,
            debug: new ToolingFlowDebugGateway(context.connection),
          }).debug(await createRollbackRequest(flags, context), progress)
        )
      : {
          result: await withFlowProgress(this.spinner, 'run', async (progress) =>
            new FlowRunService({
              definition: definitionGateway,
              invocation: new RestFlowInvocationGateway(context.connection),
            }).run(await createRunRequest(flags, context), progress)
          ),
          rawLog: '',
        };
    await persistArtifact(flags, artifact);
    const { result } = artifact;
    this.writeHumanOutput(result);
    if (flags['fail-on-flow-error'] && result.successful === false) {
      process.exitCode = 1;
    }
    return result;
  }

  private warnSideEffects(flags: RunFlagValues): void {
    if (this.jsonEnabled()) {
      return;
    }
    if (flags.rollback && !flags['dry-run']) {
      this.warn(messages.getMessage('warnings.rollback'));
      if (flags['raw-log-file'] !== undefined) {
        this.warn(messages.getMessage('warnings.raw-log'));
      }
    } else if (!flags['dry-run']) {
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
      this.log(messages.getMessage(result.debug === undefined ? 'info.dry-run' : 'info.rollback-dry-run'));
    } else if (result.debug?.debugLog !== undefined && result.debug.debugLog !== null) {
      this.table({
        title: messages.getMessage('info.trace-title', [result.debug.debugLog.id]),
        data: result.debug.events.map((event) => ({ ...event })),
        columns: [
          { key: 'sequence', name: '#' },
          { key: 'timestamp', name: 'Timestamp' },
          { key: 'event', name: 'Event' },
          { key: 'elementType', name: 'Element Type' },
          { key: 'elementName', name: 'Element' },
          { key: 'detail', name: 'Detail' },
        ],
      });
      this.log(messages.getMessage('info.rollback-duration', [result.durationMilliseconds]));
    } else if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.request-duration', [result.durationMilliseconds]));
    }
  }
}
