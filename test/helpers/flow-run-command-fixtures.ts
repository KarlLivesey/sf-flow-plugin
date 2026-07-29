/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';

import type { RunFlagValues } from '../../src/commands/flow/run.js';
import type { FlowRunResult } from '../../src/types/flow-invocation.js';
import { createCommandOrg } from './command-org.js';

export const flowRunResult: FlowRunResult = {
  apiName: 'Calculate_Discount',
  namespace: null,
  definitionId: '300000000000001',
  version: 1,
  processType: 'AutoLaunchedFlow',
  production: false,
  dryRun: false,
  durationMilliseconds: 25,
  successful: true,
  invocations: [
    {
      interviewId: 'interview-1',
      version: 1,
      success: true,
      inputs: { percentage: 10 },
      outputs: { discount: 10 },
      errors: [],
      executed: true,
    },
  ],
  targetOrg: 'admin@example.com',
};

export function rollbackDryRunResult(): FlowRunResult {
  return {
    ...flowRunResult,
    dryRun: true,
    successful: null,
    invocations: [
      {
        interviewId: null,
        version: 1,
        success: null,
        inputs: { percentage: 10 },
        outputs: {},
        errors: [],
        executed: false,
      },
    ],
    debug: {
      correlationId: null,
      databaseChangesRolledBack: null,
      valuesShown: false,
      error: null,
      debugLog: null,
      events: [],
    },
  };
}

export function rollbackRunResult(databaseChangesRolledBack: true | null): FlowRunResult {
  return {
    ...flowRunResult,
    successful: databaseChangesRolledBack === true,
    invocations: flowRunResult.invocations.map((invocation) => ({
      ...invocation,
      success: databaseChangesRolledBack === true,
    })),
    debug: {
      correlationId: 'correlation-1',
      databaseChangesRolledBack,
      valuesShown: false,
      error: null,
      debugLog: {
        id: '07L000000000001',
        status: 'Success',
        operation: 'executeAnonymous',
        startTime: '2026-07-27T10:00:00.000Z',
        durationMilliseconds: 25,
        logLength: 1000,
      },
      events: [],
    },
  };
}

export function runFlags(): RunFlagValues {
  return {
    'api-name': 'Calculate_Discount',
    'target-org': createCommandOrg({} as Connection),
    input: ['percentage=10'],
    'input-file': undefined,
    'output-file': undefined,
    'raw-log-file': undefined,
    'dry-run': false,
    rollback: false,
    confirm: false,
    'log-level': 'detailed',
    'show-values': false,
    wait: 2,
    'fail-on-flow-error': false,
    'if-active-version': undefined,
    namespace: undefined,
    'api-version': undefined,
  };
}
