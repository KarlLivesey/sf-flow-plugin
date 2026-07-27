/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDebugFailed, flowDebugRollbackFailed } from '../errors/flow-errors.js';
import type { JsonObject, JsonValue } from '../types/flow-analysis.js';
import type { FlowDebugArtifact, FlowDebugTransportResult } from '../types/flow-debug.js';
import type { FlowInvocationError, FlowRollbackRequest, FlowRunResult } from '../types/flow-invocation.js';
import type { FlowDefinition, FlowVersion } from '../types/flow.js';
import type { parseFlowDebugLog } from './flow-debug-log.js';

export interface PreparedFlowDebug {
  flow: {
    definition: FlowDefinition;
    version: FlowVersion;
    apiName: string;
  };
  input: JsonObject;
  production: boolean;
}

export interface ExecutedFlowDebug {
  transport: FlowDebugTransportResult;
  durationMilliseconds: number;
  parsed: ReturnType<typeof parseFlowDebugLog>;
}

interface ResultContext {
  request: FlowRollbackRequest;
  prepared: PreparedFlowDebug;
  executed: ExecutedFlowDebug;
}

function visibleValues(value: Readonly<Record<string, JsonValue>>, showValues: boolean): Record<string, JsonValue> {
  return showValues ? { ...value } : Object.fromEntries(Object.keys(value).map((key) => [key, '[REDACTED]']));
}

function assertCompleted(context: ResultContext): void {
  const { prepared, executed } = context;
  if (!executed.transport.execution.success) {
    return;
  }
  if (!executed.parsed.endMarker) {
    throw flowDebugFailed(
      `The correlated log for Flow "${prepared.flow.apiName}" did not contain a completion marker.`
    );
  }
  if (!executed.parsed.rollbackMarker) {
    throw flowDebugRollbackFailed(prepared.flow.apiName);
  }
}

function executionError(context: ResultContext): ReturnType<typeof parseFlowDebugLog>['error'] {
  if (context.executed.parsed.error !== null) {
    return context.executed.parsed.error;
  }
  return context.executed.transport.execution.success
    ? null
    : {
        type: null,
        message: 'Salesforce terminated the debug transaction; inspect the Flow trace for details.',
      };
}

function invocationErrors(context: ResultContext): FlowInvocationError[] {
  const error = executionError(context);
  return error === null ? [] : [{ message: error.message, code: error.type }];
}

export function createFlowDebugArtifact(context: ResultContext): FlowDebugArtifact<FlowRunResult> {
  assertCompleted(context);
  const { request, prepared, executed } = context;
  const { flow, input, production } = prepared;
  const successful = executed.transport.execution.success && executed.parsed.error === null;
  return {
    result: {
      apiName: flow.definition.apiName,
      namespace: flow.definition.namespace,
      definitionId: flow.definition.id,
      version: flow.version.versionNumber,
      processType: flow.version.processType,
      production,
      dryRun: false,
      successful,
      durationMilliseconds: executed.durationMilliseconds,
      invocations: [
        {
          interviewId: executed.parsed.interviewId,
          version: flow.version.versionNumber,
          success: successful,
          inputs: visibleValues(input, request.showValues),
          outputs: visibleValues(executed.parsed.outputs, request.showValues),
          errors: invocationErrors(context),
          executed: true,
        },
      ],
      targetOrg: request.targetOrg,
      debug: {
        correlationId: executed.transport.correlationId,
        databaseChangesRolledBack: true,
        valuesShown: request.showValues,
        error: executionError(context),
        debugLog: executed.transport.log,
        events: executed.parsed.events,
      },
    },
    rawLog: executed.transport.rawLog,
  };
}

export function createFlowDebugDryRunArtifact(
  request: FlowRollbackRequest,
  prepared: PreparedFlowDebug
): FlowDebugArtifact<FlowRunResult> {
  const { flow, input, production } = prepared;
  return {
    result: {
      apiName: flow.definition.apiName,
      namespace: flow.definition.namespace,
      definitionId: flow.definition.id,
      version: flow.version.versionNumber,
      processType: flow.version.processType,
      production,
      dryRun: true,
      successful: null,
      durationMilliseconds: 0,
      invocations: [
        {
          interviewId: null,
          version: flow.version.versionNumber,
          success: null,
          inputs: visibleValues(input, request.showValues),
          outputs: {},
          errors: [],
          executed: false,
        },
      ],
      targetOrg: request.targetOrg,
      debug: {
        correlationId: null,
        databaseChangesRolledBack: null,
        valuesShown: request.showValues,
        error: null,
        debugLog: null,
        events: [],
      },
    },
    rawLog: '',
  };
}
