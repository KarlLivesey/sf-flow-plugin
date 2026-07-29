/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Interfaces } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { SfCommand } from '@salesforce/sf-plugins-core';

import type { FlowRunResult } from '../../types/flow-invocation.js';
import { createFlowCommandContext, validateNamedFlowFlags } from '../../utils/flow-command.js';
import FlowRun, { executeFlowRunCommand, type RunFlagValues } from './run.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.debug');
type DebugFlagValues = Omit<RunFlagValues, 'rollback'>;

export default class FlowDebug extends SfCommand<FlowRunResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags: Interfaces.FlagInput = {
    'api-name': FlowRun.flags['api-name'],
    'target-org': FlowRun.flags['target-org'],
    input: FlowRun.flags.input,
    'input-file': {
      ...FlowRun.flags['input-file'],
      summary: messages.getMessage('flags.input-file.summary'),
    },
    'output-file': FlowRun.flags['output-file'],
    'raw-log-file': {
      ...FlowRun.flags['raw-log-file'],
      relationships: [],
      summary: messages.getMessage('flags.raw-log-file.summary'),
    },
    'dry-run': FlowRun.flags['dry-run'],
    confirm: FlowRun.flags.confirm,
    'log-level': {
      ...FlowRun.flags['log-level'],
      relationships: [],
      summary: messages.getMessage('flags.log-level.summary'),
    },
    'show-values': {
      ...FlowRun.flags['show-values'],
      relationships: [],
      summary: messages.getMessage('flags.show-values.summary'),
    },
    wait: {
      ...FlowRun.flags.wait,
      relationships: [],
    },
    'fail-on-flow-error': FlowRun.flags['fail-on-flow-error'],
    'if-active-version': FlowRun.flags['if-active-version'],
    namespace: FlowRun.flags.namespace,
    'api-version': FlowRun.flags['api-version'],
  };

  public async parseFlags(): Promise<DebugFlagValues> {
    const { flags } = await this.parse(FlowDebug);
    return flags as unknown as DebugFlagValues;
  }

  public override async run(): Promise<FlowRunResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    return executeFlowRunCommand(this, { ...flags, rollback: true }, context);
  }
}
