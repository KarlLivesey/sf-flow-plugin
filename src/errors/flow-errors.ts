/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SfError } from '@salesforce/core';

import type { FlowErrorCode, FlowVersionSelector } from '../types/flow.js';

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

export function flowDefinitionNotFound(apiName: string): SfError {
  return createFlowError({
    code: 'FlowDefinitionNotFound',
    message: `No Flow definition matching "${apiName}" was found.`,
    action: 'Check the Flow API name and namespace, then try again.',
  });
}

export function flowDefinitionAmbiguous(apiName: string): SfError {
  return createFlowError({
    code: 'FlowDefinitionAmbiguous',
    message: `More than one Flow definition matches "${apiName}".`,
    action: 'Specify --namespace to identify the packaged Flow.',
  });
}

export function flowVersionInvalid(value: string): SfError {
  return createFlowError({
    code: 'FlowVersionInvalid',
    message: `Flow version "${value}" is invalid.`,
    action: 'Specify "latest" or a positive whole number.',
  });
}

export function flowVersionNotFound(apiName: string, version: FlowVersionSelector): SfError {
  return createFlowError({
    code: 'FlowVersionNotFound',
    message: `Flow "${apiName}" does not have version "${version}".`,
    action: 'Choose an existing Flow version or use --flow-version latest.',
  });
}

export function flowVersionNotActivatable(apiName: string, version: number, status: string): SfError {
  return createFlowError({
    code: 'FlowVersionNotActivatable',
    message: `Flow "${apiName}" version ${version} has status "${status}" and cannot be activated.`,
    action: 'Choose a Flow version whose status is Draft or Active.',
  });
}

export function flowActiveVersionMismatch(apiName: string, expected: number, actual: number | null): SfError {
  return createFlowError({
    code: 'FlowActiveVersionMismatch',
    message: `Flow "${apiName}" has active version ${actual ?? 'none'}; expected version ${expected}.`,
    action: 'Inspect the current Flow state and retry with the expected active version.',
  });
}

export function flowActivationFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowActivationFailed',
    message,
    action: 'Confirm the org supports Tooling API Flow updates and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowActivationVerificationFailed(apiName: string, version: number): SfError {
  return createFlowError({
    code: 'FlowActivationVerificationFailed',
    message: `Salesforce did not report Flow "${apiName}" version ${version} as active after the update.`,
    action: 'Query the Flow definition in Salesforce and retry the activation.',
  });
}

export function flowQueryFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowQueryFailed',
    message,
    action: 'Confirm the org supports Tooling API Flow queries and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowMutationFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowMutationFailed',
    message,
    action: 'Confirm the org supports Tooling API Flow updates and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowMutationPermissionDenied(operation: string): SfError {
  return createFlowError({
    code: 'FlowMutationPermissionDenied',
    message: `The authenticated user cannot ${operation} through the Salesforce Tooling API.`,
    action: 'Grant the user the required Flow management and Tooling API access, then try again.',
  });
}

export function flowDeactivationFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDeactivationFailed',
    message,
    action: 'Confirm the Flow can be deactivated and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDeactivationVerificationFailed(apiName: string): SfError {
  return createFlowError({
    code: 'FlowDeactivationVerificationFailed',
    message: `Salesforce still reports Flow "${apiName}" as active after the update.`,
    action: 'Query the Flow definition in Salesforce and retry the deactivation.',
  });
}

export function flowAuditFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowAuditFailed',
    message,
    action: 'Confirm the org supports Tooling API Flow queries and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowListFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowListFailed',
    message,
    action: 'Confirm the org supports Tooling API Flow queries and that your user has sufficient permissions.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowDependenciesFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowDependenciesFailed',
    message,
    action: 'Confirm the org supports Tooling API metadata dependency queries and that your user has permission.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowComparisonFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowComparisonFailed',
    message,
    action: 'Check the requested Flow versions and confirm that your user can read Flow metadata.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowInspectionFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowInspectionFailed',
    message,
    action: 'Check the requested Flow version and confirm that your user can read Flow metadata.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowLintFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowLintFailed',
    message,
    action: 'Confirm the Flow metadata is accessible and valid, then run the command again.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowGraphOptionsInvalid(message: string): SfError {
  return createFlowError({
    code: 'FlowInspectionFailed',
    message,
    action: 'Use Mermaid output or remove the Mermaid-only routing flags.',
  });
}

export function flowPruneFailed(message: string, cause?: unknown): SfError {
  return createFlowError({
    code: 'FlowPruneFailed',
    message,
    action: 'Review the planned versions and confirm that Salesforce permits deleting them.',
    ...(cause === undefined ? {} : { cause }),
  });
}

export function flowPruneVerificationFailed(apiName: string): SfError {
  return createFlowError({
    code: 'FlowPruneVerificationFailed',
    message: `Salesforce still reports one or more deleted versions for Flow "${apiName}".`,
    action: 'Query the Flow versions in Salesforce and retry the prune operation.',
  });
}
