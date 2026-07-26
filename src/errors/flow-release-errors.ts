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

export function flowDeleteVersionFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDeleteVersionFailed',
    message,
    action: 'Review the selected version and confirm that Salesforce permits deleting it.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDeleteVersionVerificationFailed(apiName: string, version: number): SfError {
  return createFlowError({
    code: 'FlowDeleteVersionVerificationFailed',
    message: `Salesforce still reports Flow "${apiName}" version ${version} after deletion.`,
    action: 'Query the Flow versions in Salesforce and retry the deletion.',
  });
}

export function flowMetricsFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowMetricsFailed',
    message,
    action: 'Check the requested Flow version and confirm that your user can read its metadata.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDataCloudMetricsUnavailable(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDataCloudMetricsUnavailable',
    message,
    action:
      'Confirm that Data Cloud is provisioned, Flow metrics collection is enabled for this Flow, and the authenticated user can query its Flow DMOs.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDataCloudMetricsFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDataCloudMetricsFailed',
    message,
    action: 'Confirm Data Cloud access and retry the Flow metrics query.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowCheckFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowCheckFailed',
    message,
    action: 'Review the selected checks and confirm that the Flow metadata is accessible.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowBundleFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowBundleFailed',
    message,
    action: 'Review the selected Flow versions, dependencies and output directory, then run the command again.',
    ...(cause === undefined ? {} : { cause }),
  });
}
