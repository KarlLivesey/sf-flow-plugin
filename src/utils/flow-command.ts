/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { SfError } from '@salesforce/core';
import type { Connection, Org } from '@salesforce/core';

import { flowQueryFailed } from '../errors/flow-errors.js';
import type { NamedFlowRequest } from '../types/flow.js';
import { validateFlowApiName, validateNamespace } from './flow-name-validation.js';

export interface TargetOrgFlagValues {
  'target-org': Org | undefined;
  'api-version': string | undefined;
}

export interface NamedFlowFlagValues extends TargetOrgFlagValues {
  'api-name': string;
  namespace: string | undefined;
}

export interface FlowCommandContext {
  connection: Connection;
  targetOrg: string;
}

export function validateNamedFlowFlags(flags: NamedFlowFlagValues): void {
  validateFlowApiName(flags['api-name']);
  if (flags.namespace !== undefined) {
    validateNamespace(flags.namespace);
  }
}

export function createFlowCommandContext(flags: TargetOrgFlagValues): FlowCommandContext {
  const org = flags['target-org'];
  if (org === undefined) {
    throw SfError.create({
      name: 'TargetOrgNotFound',
      message: 'No target org was provided or configured.',
      actions: ['Specify --target-org or configure the Salesforce CLI target-org value.'],
    });
  }
  const targetOrg = org.getUsername();
  if (targetOrg === undefined) {
    throw flowQueryFailed('The target org does not have an authenticated username.');
  }
  return { connection: org.getConnection(flags['api-version']), targetOrg };
}

export function createNamedFlowRequest(flags: NamedFlowFlagValues, context: FlowCommandContext): NamedFlowRequest {
  const base = { apiName: flags['api-name'], targetOrg: context.targetOrg };
  const withNamespace = flags.namespace === undefined ? base : { ...base, namespace: flags.namespace };
  return flags['api-version'] === undefined ? withNamespace : { ...withNamespace, apiVersion: flags['api-version'] };
}
