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

export function flowBenchmarkFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowBenchmarkFailed',
    message,
    action: 'Review the failed benchmark sample and confirm that rollback tracing remains available.',
    ...(cause === undefined ? {} : { cause }),
  });
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
    action: 'Grant the permissions required to execute anonymous Apex and invoke the Flow, then try again.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDebugRollbackFailed(apiName: string, logId?: string): SfError {
  const logContext = logId === undefined ? '' : ` ApexLog ID: ${logId}.`;
  return createFlowError({
    code: 'FlowDebugRollbackFailed',
    message: `Flow "${apiName}" finished without the expected database rollback confirmation marker.${logContext}`,
    action: 'Treat the execution outcome as unsafe and inspect the returned or saved raw debug log.',
  });
}
