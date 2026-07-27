/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SfError } from '@salesforce/core';

import type { FlowErrorCode } from '../types/flow-errors.js';

interface FlowErrorOptions {
  code: FlowErrorCode;
  message: string;
  action: string;
  cause?: unknown;
}

function createFlowError(options: FlowErrorOptions): SfError {
  const base = {
    message: options.message,
    name: options.code,
    actions: [options.action],
  };
  return options.cause === undefined ? SfError.create(base) : SfError.create({ ...base, cause: options.cause });
}

export function flowDebugFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDebugFailed',
    message,
    action: 'Review the Flow debug trace and confirm that the authenticated user can execute anonymous Apex.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDebugPermissionDenied(apiName: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDebugPermissionDenied',
    message: `The authenticated user does not have all permissions required to debug Flow "${apiName}".`,
    action:
      'Grant Author Apex, temporary DebugLevel and TraceFlag management, and ApexLog query and retrieval access, then try again.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDebugLogNotFound(apiName: string): SfError {
  return createFlowError({
    code: 'FlowDebugLogNotFound',
    message: `Salesforce did not make the correlated debug log for Flow "${apiName}" available before the timeout.`,
    action: 'Increase --wait and confirm that the org is generating Apex debug logs for the authenticated user.',
  });
}

export function flowDebugCleanupFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDebugCleanupFailed',
    message,
    action:
      'Inspect TraceFlag and DebugLevel records in the target org and remove only the temporary sf-flow-plugin records.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDebugRollbackFailed(apiName: string, logId?: string): SfError {
  const logContext = logId === undefined ? '' : ` ApexLog ID: ${logId}.`;
  return createFlowError({
    code: 'FlowDebugRollbackFailed',
    message: `Flow "${apiName}" finished without the expected database rollback confirmation marker.${logContext}`,
    action:
      'Treat the execution outcome as unsafe and retrieve the identified log with sf apex get log before running the command again.',
  });
}
