/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonValue } from './flow-analysis.js';
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';

export interface FlowRunRequest extends NamedFlowRequest {
  invocations: JsonObject[];
  dryRun: boolean;
  confirm: boolean;
}

export interface FlowInvocationError {
  message: string;
  code: string | null;
}

export interface FlowInvocation {
  interviewId: string | null;
  version: FlowVersionNumber;
  success: boolean | null;
  inputs: JsonObject;
  outputs: Record<string, JsonValue>;
  errors: FlowInvocationError[];
  executed: boolean;
}

export interface FlowRunResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  version: FlowVersionNumber;
  processType: string;
  production: boolean;
  dryRun: boolean;
  durationMilliseconds: number;
  successful: boolean | null;
  invocations: FlowInvocation[];
  targetOrg: string;
}

export interface FlowActionError {
  message?: string | undefined;
  statusCode?: string | undefined;
}

export interface FlowActionResult {
  actionName?: string | undefined;
  errors: Array<FlowActionError | string>;
  invocationId?: string | null | undefined;
  isSuccess: boolean;
  outputValues: Record<string, JsonValue>;
  version?: number | undefined;
}

export interface FlowInvocationGateway {
  isProductionOrg(): Promise<boolean>;
  assertFlowActionAvailable(apiName: string): Promise<void>;
  invokeFlow(apiName: string, inputs: ReadonlyArray<JsonObject>): Promise<FlowActionResult[]>;
}
