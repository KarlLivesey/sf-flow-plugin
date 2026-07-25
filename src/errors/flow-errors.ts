import { SfError } from '@salesforce/core';

import type { FlowActivationErrorCode, FlowVersionSelector } from '../types/flow.js';

interface FlowErrorOptions {
  code: FlowActivationErrorCode;
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
    action: 'Choose an existing Flow version or use --version latest.',
  });
}

export function flowVersionNotActivatable(apiName: string, version: number, status: string): SfError {
  return createFlowError({
    code: 'FlowVersionNotActivatable',
    message: `Flow "${apiName}" version ${version} has status "${status}" and cannot be activated.`,
    action: 'Choose a Flow version whose status is Draft or Active.',
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
