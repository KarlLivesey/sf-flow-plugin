/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  flowDebugFailed,
  flowDebugRollbackFailed,
  flowInputInvalid,
  flowProductionConfirmationRequired,
} from '../errors/flow-errors.js';
import type { FlowMetadataGateway, JsonObject, JsonValue } from '../types/flow-analysis.js';
import type {
  FlowDebugArtifact,
  FlowDebugGateway,
  FlowDebugTransportStage,
  FlowDebugTransportResult,
} from '../types/flow-debug.js';
import type { FlowInvocationError, FlowRollbackRequest, FlowRunResult } from '../types/flow-invocation.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import { parseFlowDebugLog } from '../utils/flow-debug-log.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowInputs } from '../utils/flow-input-schema.js';
import { noFlowProgress, type FlowProgressReporter, type FlowProgressStage } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

interface FlowDebugGateways {
  definition: FlowDefinitionGateway & FlowMetadataGateway;
  debug: FlowDebugGateway;
}

interface ResolvedDebugFlow {
  definition: FlowDefinition;
  version: FlowVersion;
  apiName: string;
  metadata: JsonObject;
}

interface PreparedDebug {
  flow: ResolvedDebugFlow;
  input: JsonObject;
  outputVariables: string[];
  production: boolean;
}

interface ExecutedDebug {
  transport: FlowDebugTransportResult;
  durationMilliseconds: number;
  parsed: ReturnType<typeof parseFlowDebugLog>;
}

interface ResultContext {
  request: FlowRollbackRequest;
  prepared: PreparedDebug;
  executed: ExecutedDebug;
}

interface ValidatedDebugInput {
  input: JsonObject;
  outputVariables: string[];
}

const MAX_DEBUG_INPUT_BYTES = 20_000;
const transportStages: Readonly<Record<FlowDebugTransportStage, FlowProgressStage>> = {
  'configuring-trace': 'configuring-trace',
  'executing-apex': 'invoking-flow',
  'retrieving-log': 'retrieving-debug-log',
  'restoring-trace': 'restoring-trace',
};

function createLookup(request: FlowRollbackRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function activeVersion(definition: FlowDefinition, versions: ReadonlyArray<FlowVersion>): FlowVersion {
  const version = versions.find((candidate) => candidate.id === definition.activeVersionId);
  if (version === undefined) {
    throw flowDebugFailed(`Flow "${definition.apiName}" does not have an active version.`);
  }
  return version;
}

function triggerType(metadata: JsonObject): string | null {
  const start = metadata.start;
  if (typeof start !== 'object' || start === null || Array.isArray(start)) {
    return null;
  }
  return typeof start.triggerType === 'string' ? start.triggerType : null;
}

function assertDebuggable(flow: ResolvedDebugFlow): void {
  const trigger = triggerType(flow.metadata);
  if (flow.version.processType !== 'AutoLaunchedFlow' || (trigger !== null && !['None', ''].includes(trigger))) {
    throw flowDebugFailed(
      `Flow "${flow.apiName}" version ${flow.version.versionNumber} is not an active, directly invocable autolaunched Flow.`
    );
  }
}

function validateInputSize(input: JsonObject): void {
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > MAX_DEBUG_INPUT_BYTES) {
    throw flowInputInvalid(
      `Flow debug input must be at most ${MAX_DEBUG_INPUT_BYTES} UTF-8 bytes; received ${bytes} bytes.`
    );
  }
}

function hiddenValues(value: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  return Object.fromEntries(Object.keys(value).map((key) => [key, '[REDACTED]']));
}

function visibleValues(value: Readonly<Record<string, JsonValue>>, showValues: boolean): Record<string, JsonValue> {
  return showValues ? { ...value } : hiddenValues(value);
}

function validateDebugInput(
  flow: ResolvedDebugFlow,
  request: FlowRollbackRequest,
  progress: FlowProgressReporter
): ValidatedDebugInput {
  const description = analyseFlowMetadata({ ...flow, depth: 0 });
  progress('validating-inputs', `${flow.apiName} v${flow.version.versionNumber}`);
  const [input] = validateFlowInputs([request.input], description.variables);
  if (input === undefined) {
    throw flowInputInvalid('Flow debug requires one input object.');
  }
  validateInputSize(input);
  const outputVariables = description.variables.filter((variable) => variable.output).map((variable) => variable.name);
  return { input, outputVariables };
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

function createArtifact(context: ResultContext): FlowDebugArtifact<FlowRunResult> {
  assertCompleted(context);
  const { request, prepared, executed } = context;
  const { flow, input, production } = prepared;
  const successful = executed.transport.execution.success && executed.parsed.error === null;
  const result: FlowRunResult = {
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
  };
  return { result, rawLog: executed.transport.rawLog };
}

async function assertActiveVersionUnchanged(gateway: FlowDefinitionGateway, flow: ResolvedDebugFlow): Promise<void> {
  const lookup =
    flow.definition.namespace === null
      ? { apiName: flow.definition.apiName }
      : { apiName: flow.definition.apiName, namespace: flow.definition.namespace };
  const current = selectFlowDefinition(flow.definition.apiName, await gateway.findDefinitions(lookup));
  const version = activeVersion(current, await gateway.findVersions(current.id));
  if (version.id !== flow.version.id) {
    throw flowDebugFailed(
      `Flow "${flow.apiName}" changed from active version ${flow.version.versionNumber} to ${version.versionNumber} during preflight.`
    );
  }
}

export class FlowDebugService {
  public constructor(private readonly gateways: FlowDebugGateways) {}

  public async debug(
    request: FlowRollbackRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowDebugArtifact<FlowRunResult>> {
    const prepared = await this.prepare(request, progress);
    const executed = await this.execute(prepared, request, progress);
    return createArtifact({ request, prepared, executed });
  }

  private async execute(
    prepared: PreparedDebug,
    request: FlowRollbackRequest,
    progress: FlowProgressReporter
  ): Promise<ExecutedDebug> {
    const started = performance.now();
    const transport = await this.gateways.debug.execute(
      {
        apiName: prepared.flow.definition.apiName,
        namespace: prepared.flow.definition.namespace,
        input: prepared.input,
        outputVariables: prepared.outputVariables,
        logLevel: request.logLevel,
        waitMilliseconds: request.waitMilliseconds,
      },
      (stage, detail) => {
        progress(transportStages[stage], detail);
      }
    );
    return {
      transport,
      durationMilliseconds: Math.round(performance.now() - started),
      parsed: parseFlowDebugLog(transport.rawLog, transport.correlationId, request.showValues),
    };
  }

  private async gateExecution(request: FlowRollbackRequest, flow: ResolvedDebugFlow): Promise<boolean> {
    const production = await this.gateways.debug.isProductionOrg();
    if (production && !request.confirm) {
      throw flowProductionConfirmationRequired(flow.apiName);
    }
    return production;
  }

  private async prepare(request: FlowRollbackRequest, progress: FlowProgressReporter): Promise<PreparedDebug> {
    const flow = await this.resolveFlow(request, progress);
    assertDebuggable(flow);
    const validated = validateDebugInput(flow, request, progress);
    progress('checking-org', request.targetOrg);
    const production = await this.gateExecution(request, flow);
    progress('checking-current-state', `${flow.apiName} v${flow.version.versionNumber} (active)`);
    await assertActiveVersionUnchanged(this.gateways.definition, flow);
    return { flow, ...validated, production };
  }

  private async resolveFlow(request: FlowRollbackRequest, progress: FlowProgressReporter): Promise<ResolvedDebugFlow> {
    progress('resolving-flow', request.apiName);
    const definition = selectFlowDefinition(
      request.apiName,
      await this.gateways.definition.findDefinitions(createLookup(request))
    );
    const apiName = qualifiedFlowName(definition.apiName, definition.namespace);
    progress('loading-versions', `${apiName} (active)`);
    const version = activeVersion(definition, await this.gateways.definition.findVersions(definition.id));
    progress('loading-metadata', `${apiName} v${version.versionNumber}`);
    const metadata = await this.gateways.definition.getVersionMetadata(version.id);
    return { definition, version, apiName, metadata };
  }
}
