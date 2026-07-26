/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInvocationFailed, flowProductionConfirmationRequired } from '../errors/flow-errors.js';
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
  flow: ResolvedRunnableFlow;
  input: JsonObject;
  action: FlowActionResult;
  durationMilliseconds: number;
}

interface RunResultContext {
  request: FlowRunRequest;
  flow: ResolvedRunnableFlow;
  production: boolean;
  invocations: FlowInvocation[];
}

interface ExecuteInputsContext {
  gateway: FlowInvocationGateway;
  flow: ResolvedRunnableFlow;
  inputs: JsonObject[];
  progress: FlowProgressReporter;
}

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
      ? { message: error, code: null }
      : { message: error.message ?? 'Salesforce reported a Flow error.', code: error.statusCode ?? null }
  );
}

function invocationResult(context: InvocationResultContext): FlowInvocation {
  const { flow, input, action, durationMilliseconds } = context;
  return {
    interviewId: action.invocationId ?? null,
    version: action.version ?? flow.version.versionNumber,
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

async function invokeOne(
  gateway: FlowInvocationGateway,
  flow: ResolvedRunnableFlow,
  input: JsonObject
): Promise<FlowInvocation> {
  const started = performance.now();
  const results = await gateway.invokeFlow(flow.apiName, [input]);
  const action = results[0];
  if (action === undefined || results.length !== 1) {
    throw flowInvocationFailed(`Salesforce returned an unexpected invocation result for Flow "${flow.apiName}".`);
  }
  return invocationResult({ flow, input, action, durationMilliseconds: Math.round(performance.now() - started) });
}

async function executeInputs(context: ExecuteInputsContext): Promise<FlowInvocation[]> {
  const { gateway, flow, inputs, progress } = context;
  return inputs.reduce<Promise<FlowInvocation[]>>(async (previous, input, index) => {
    const results = await previous;
    progress('invoking-flow', `${flow.apiName} v${flow.version.versionNumber} (${index + 1}/${inputs.length})`);
    return [...results, await invokeOne(gateway, flow, input)];
  }, Promise.resolve([]));
}

function createResult(context: RunResultContext): FlowRunResult {
  const { request, flow, production, invocations } = context;
  return {
    apiName: flow.definition.apiName,
    namespace: flow.definition.namespace,
    definitionId: flow.definition.id,
    version: flow.version.versionNumber,
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
    const flow = await this.resolveFlow(request, progress);
    assertRunnable(flow);
    const description = analyseFlowMetadata({ ...flow, depth: 0 });
    progress('validating-inputs', `${flow.apiName} v${flow.version.versionNumber} (${request.invocations.length})`);
    const inputs = validateFlowInputs(request.invocations, description.variables);
    progress('checking-org', request.targetOrg);
    const production = await this.gateExecution(request, flow, progress);
    const invocations = request.dryRun
      ? inputs.map((input) => dryRunInvocation(flow, input))
      : await executeInputs({ gateway: this.gateways.invocation, flow, inputs, progress });
    return createResult({ request, flow, production, invocations });
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
