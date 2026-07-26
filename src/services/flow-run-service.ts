/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInputInvalid, flowInvocationFailed, flowProductionConfirmationRequired } from '../errors/flow-errors.js';
import type { FlowMetadataGateway, JsonObject } from '../types/flow-analysis.js';
import type {
  FlowActionResult,
  FlowInvocation,
  FlowInvocationError,
  FlowInvocationGateway,
  FlowRunRequest,
  FlowRunResult,
} from '../types/flow-invocation.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowInputs } from '../utils/flow-input-schema.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { redactFlowObject } from '../utils/flow-redaction.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

interface FlowRunGateways {
  definition: FlowDefinitionGateway & FlowMetadataGateway;
  invocation: FlowInvocationGateway;
}

interface ResolvedRunnableFlow {
  definition: FlowDefinition;
  version: FlowVersion;
  apiName: string;
  metadata: JsonObject;
}

interface InvocationResultContext {
  input: JsonObject;
  action: FlowActionResult;
  version: number;
  durationMilliseconds: number;
}

interface RunResultContext {
  request: FlowRunRequest;
  flow: ResolvedRunnableFlow;
  version: number;
  production: boolean;
  invocations: FlowInvocation[];
}

interface ExecuteInputsContext {
  gateway: FlowInvocationGateway;
  definitionGateway: FlowDefinitionGateway;
  flow: ResolvedRunnableFlow;
  inputs: JsonObject[];
  progress: FlowProgressReporter;
}

interface ExecutedInputs {
  version: number;
  invocations: FlowInvocation[];
}

const MAX_FLOW_ACTION_INVOCATIONS = 200;
const REDACTED_ERROR_MESSAGE = 'Salesforce reported a Flow error; message redacted.';

function createLookup(request: FlowRunRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function activeVersion(definition: FlowDefinition, versions: ReadonlyArray<FlowVersion>): FlowVersion {
  const version = versions.find((candidate) => candidate.id === definition.activeVersionId);
  if (version === undefined) {
    throw flowInvocationFailed(`Flow "${definition.apiName}" does not have an active version.`);
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

function assertRunnable(flow: ResolvedRunnableFlow): void {
  const trigger = triggerType(flow.metadata);
  if (flow.version.processType !== 'AutoLaunchedFlow' || (trigger !== null && !['None', ''].includes(trigger))) {
    throw flowInvocationFailed(
      `Flow "${flow.apiName}" version ${flow.version.versionNumber} is not an active, directly invocable autolaunched Flow.`
    );
  }
}

function normaliseErrors(result: FlowActionResult): FlowInvocationError[] {
  return result.errors.map((error) =>
    typeof error === 'string'
      ? { message: REDACTED_ERROR_MESSAGE, code: null }
      : {
          message: REDACTED_ERROR_MESSAGE,
          code: error.statusCode?.match(/^[A-Z][A-Z0-9_]*$/u)?.[0] ?? null,
        }
  );
}

function invocationResult(context: InvocationResultContext): FlowInvocation {
  const { input, action, version, durationMilliseconds } = context;
  return {
    interviewId: action.invocationId ?? null,
    version,
    success: action.isSuccess && action.errors.length === 0,
    inputs: redactFlowObject(input),
    outputs: redactFlowObject(action.outputValues),
    errors: normaliseErrors(action),
    durationMilliseconds,
    executed: true,
  };
}

function dryRunInvocation(flow: ResolvedRunnableFlow, input: JsonObject): FlowInvocation {
  return {
    interviewId: null,
    version: flow.version.versionNumber,
    success: true,
    inputs: redactFlowObject(input),
    outputs: {},
    errors: [],
    durationMilliseconds: 0,
    executed: false,
  };
}

function assertBatchSize(inputs: ReadonlyArray<JsonObject>): void {
  if (inputs.length > MAX_FLOW_ACTION_INVOCATIONS) {
    throw flowInputInvalid(
      `A Flow action request supports at most ${MAX_FLOW_ACTION_INVOCATIONS} invocations; received ${inputs.length}.`
    );
  }
}

function assertResultCount(flow: ResolvedRunnableFlow, inputs: JsonObject[], actions: FlowActionResult[]): void {
  if (actions.length !== inputs.length) {
    throw flowInvocationFailed(
      `Salesforce returned ${actions.length} results for ${inputs.length} invocations of Flow "${flow.apiName}".`
    );
  }
}

function executionVersion(flow: ResolvedRunnableFlow, actions: ReadonlyArray<FlowActionResult>): number {
  const versions = new Set(actions.flatMap((action) => (action.version === undefined ? [] : [action.version])));
  if (versions.size !== 1) {
    if (versions.size === 0) {
      return flow.version.versionNumber;
    }
    throw flowInvocationFailed(`Salesforce reported mixed active versions for Flow "${flow.apiName}".`);
  }
  return [...versions][0] ?? flow.version.versionNumber;
}

async function assertActiveVersionUnchanged(gateway: FlowDefinitionGateway, flow: ResolvedRunnableFlow): Promise<void> {
  const lookup =
    flow.definition.namespace === null
      ? { apiName: flow.definition.apiName }
      : { apiName: flow.definition.apiName, namespace: flow.definition.namespace };
  const definition = selectFlowDefinition(flow.definition.apiName, await gateway.findDefinitions(lookup));
  const version = activeVersion(definition, await gateway.findVersions(definition.id));
  if (version.id !== flow.version.id) {
    throw flowInvocationFailed(
      `Flow "${flow.apiName}" changed from active version ${flow.version.versionNumber} to ${version.versionNumber} during preflight.`
    );
  }
}

async function executeInputs(context: ExecuteInputsContext): Promise<ExecutedInputs> {
  const { gateway, definitionGateway, flow, inputs, progress } = context;
  await assertActiveVersionUnchanged(definitionGateway, flow);
  progress('invoking-flow', `${flow.apiName} v${flow.version.versionNumber} (${inputs.length} in one request)`);
  const started = performance.now();
  const actions = await gateway.invokeFlow(flow.apiName, inputs);
  const durationMilliseconds = Math.round(performance.now() - started);
  assertResultCount(flow, inputs, actions);
  const version = executionVersion(flow, actions);
  return {
    version,
    invocations: actions.map((action, index) =>
      invocationResult({ input: inputs[index] ?? {}, action, version, durationMilliseconds })
    ),
  };
}

function createResult(context: RunResultContext): FlowRunResult {
  const { request, flow, version, production, invocations } = context;
  return {
    apiName: flow.definition.apiName,
    namespace: flow.definition.namespace,
    definitionId: flow.definition.id,
    version,
    processType: flow.version.processType,
    production,
    dryRun: request.dryRun,
    successful: invocations.every((invocation) => invocation.success),
    invocations,
    targetOrg: request.targetOrg,
  };
}

export class FlowRunService {
  public constructor(private readonly gateways: FlowRunGateways) {}

  public async run(request: FlowRunRequest, progress: FlowProgressReporter = noFlowProgress): Promise<FlowRunResult> {
    assertBatchSize(request.invocations);
    const flow = await this.resolveFlow(request, progress);
    assertRunnable(flow);
    const description = analyseFlowMetadata({ ...flow, depth: 0 });
    progress('validating-inputs', `${flow.apiName} v${flow.version.versionNumber} (${request.invocations.length})`);
    const inputs = validateFlowInputs(request.invocations, description.variables);
    progress('checking-org', request.targetOrg);
    const production = await this.gateExecution(request, flow, progress);
    const executed: ExecutedInputs = request.dryRun
      ? { version: flow.version.versionNumber, invocations: inputs.map((input) => dryRunInvocation(flow, input)) }
      : await executeInputs({
          gateway: this.gateways.invocation,
          definitionGateway: this.gateways.definition,
          flow,
          inputs,
          progress,
        });
    return createResult({ request, flow, version: executed.version, production, invocations: executed.invocations });
  }

  private async resolveFlow(request: FlowRunRequest, progress: FlowProgressReporter): Promise<ResolvedRunnableFlow> {
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

  private async gateExecution(
    request: FlowRunRequest,
    flow: ResolvedRunnableFlow,
    progress: FlowProgressReporter
  ): Promise<boolean> {
    const production = await this.gateways.invocation.isProductionOrg();
    if (!request.dryRun && production && !request.confirm) {
      throw flowProductionConfirmationRequired(flow.apiName);
    }
    progress('checking-permissions', `${flow.apiName} v${flow.version.versionNumber} (REST Flow action)`);
    await this.gateways.invocation.assertFlowActionAvailable(flow.apiName);
    return production;
  }
}
