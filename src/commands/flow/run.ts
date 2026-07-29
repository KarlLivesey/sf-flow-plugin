/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { flowInputInvalid } from '../../errors/flow-errors.js';
import { ApexSoapFlowDebugGateway } from '../../services/apex-soap-flow-debug-gateway.js';
import { FlowDebugService } from '../../services/flow-debug-service.js';
import { FlowRunService } from '../../services/flow-run-service.js';
import { RestFlowInvocationGateway } from '../../services/rest-flow-invocation-gateway.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowDebugLogLevel } from '../../types/flow-debug.js';
import type { FlowRollbackRequest, FlowRunRequest, FlowRunResult } from '../../types/flow-invocation.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { readFlowInputs } from '../../utils/flow-input-file.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { persistFailedFlowDebugLog, persistFlowRunFiles, prepareFlowRunFiles } from '../../utils/flow-run-files.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.run');

function positiveVersion(input: string): number {
  if (!/^[1-9]\d*$/u.test(input) || !Number.isSafeInteger(Number(input))) {
    throw flowInputInvalid(`Expected active Flow version "${input}" is not a positive safe integer.`);
  }
  return Number(input);
}

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
  'if-active-version': number | undefined;
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
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
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
  const waitMilliseconds = waitMinutes * 60_000;
  if (!Number.isSafeInteger(waitMinutes) || waitMinutes < 1 || !Number.isSafeInteger(waitMilliseconds)) {
    throw flowInputInvalid(
      `Flow rollback log wait must be a positive whole-minute value with a safely representable millisecond value; received ${waitMinutes}.`
    );
  }
  return {
    ...createNamedFlowRequest(flags, context),
    input,
    dryRun: flags['dry-run'],
    confirm: flags.confirm,
    logLevel: flags['log-level'] ?? 'detailed',
    showValues: flags['show-values'] ?? false,
    waitMilliseconds,
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
  };
}

type FlowRunCommand = SfCommand<FlowRunResult>;

function warnSideEffects(command: FlowRunCommand, flags: RunFlagValues): void {
  if (command.jsonEnabled()) {
    return;
  }
  if (flags.rollback && !flags['dry-run']) {
    command.warn(messages.getMessage('warnings.rollback'));
    if (flags['raw-log-file'] !== undefined) {
      command.warn(messages.getMessage('warnings.raw-log'));
    }
  } else if (!flags['dry-run']) {
    command.warn(messages.getMessage('warnings.side-effects'));
  }
}

function writeRollbackStatus(command: FlowRunCommand, result: FlowRunResult): void {
  if (command.jsonEnabled() || result.debug?.debugLog === null || result.debug?.debugLog === undefined) {
    return;
  }
  if (result.debug.databaseChangesRolledBack === true) {
    command.log(messages.getMessage('info.rollback-confirmed'));
  } else {
    command.warn(messages.getMessage('warnings.rollback-unconfirmed'));
  }
}

function writeHumanOutput(command: FlowRunCommand, result: FlowRunResult): void {
  command.table({
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
  if (result.dryRun && !command.jsonEnabled()) {
    command.log(messages.getMessage(result.debug === undefined ? 'info.dry-run' : 'info.rollback-dry-run'));
  } else if (result.debug?.debugLog !== undefined && result.debug.debugLog !== null) {
    command.table({
      title: messages.getMessage('info.trace-title'),
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
    writeRollbackStatus(command, result);
    command.log(messages.getMessage('info.rollback-duration', [result.durationMilliseconds]));
  } else if (!command.jsonEnabled()) {
    command.log(messages.getMessage('info.request-duration', [result.durationMilliseconds]));
  }
}

export async function executeFlowRunCommand(
  command: FlowRunCommand,
  flags: RunFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): Promise<FlowRunResult> {
  const definitionGateway = new ToolingFlowDefinitionGateway(context.connection);
  const destinations = await prepareFlowRunFiles(flags['output-file'], flags['raw-log-file']);
  warnSideEffects(command, flags);
  const artifact = flags.rollback
    ? await withFlowProgress(command.spinner, 'run', async (progress) =>
        new FlowDebugService({
          definition: definitionGateway,
          debug: new ApexSoapFlowDebugGateway(context.connection),
        }).debug(await createRollbackRequest(flags, context), progress, async (rawLog) =>
          persistFailedFlowDebugLog(destinations, rawLog)
        )
      )
    : {
        result: await withFlowProgress(command.spinner, 'run', async (progress) =>
          new FlowRunService({
            definition: definitionGateway,
            invocation: new RestFlowInvocationGateway(context.connection),
          }).run(await createRunRequest(flags, context), progress)
        ),
        rawLog: '',
      };
  await persistFlowRunFiles(destinations, artifact);
  const { result } = artifact;
  writeHumanOutput(command, result);
  if (flags['fail-on-flow-error'] && result.successful === false) {
    process.exitCode = 1;
  }
  return result;
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
    'if-active-version': Flags.custom<number>({
      parse: (input: string): Promise<number> => Promise.resolve(positiveVersion(input)),
      summary: messages.getMessage('flags.if-active-version.summary'),
    })(),
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
    return executeFlowRunCommand(this, flags, context);
  }

  public async parseFlags(): Promise<RunFlagValues> {
    const { flags } = await this.parse(FlowRun);
    return flags;
  }
}
