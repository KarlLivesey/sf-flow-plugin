/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowBenchmarkFailed, flowInputInvalid } from '../errors/flow-errors.js';
import type { FlowMetadataGateway, JsonObject } from '../types/flow-analysis.js';
import type {
  FlowBenchmarkArtifact,
  FlowBenchmarkRequest,
  FlowBenchmarkSession,
  FlowBenchmarkSessionGateway,
} from '../types/flow-benchmark.js';
import type { FlowDebugGateway } from '../types/flow-debug.js';
import type { FlowRollbackRequest } from '../types/flow-invocation.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { createFlowBenchmarkLogStage, discardFlowBenchmarkLogStage } from '../utils/flow-benchmark-files.js';
import { assertBenchmarkWorkload } from '../utils/flow-benchmark-flags.js';
import { createFlowBenchmarkResult } from '../utils/flow-benchmark-result.js';
import type { CompletedBenchmarkSample } from '../utils/flow-benchmark-sample.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowInputs } from '../utils/flow-input-schema.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';
import { FlowDebugService, type PreparedDebug } from './flow-debug-service.js';
import { FLOW_BENCHMARK_BATCH_SIZE, FlowBenchmarkPhaseRunner } from './flow-benchmark-phase-runner.js';

const MINIMUM_TRACE_DURATION_MILLISECONDS = 10 * 60_000;
const MAXIMUM_TRACE_DURATION_MILLISECONDS = 60 * 60_000;

interface FlowBenchmarkGateways {
  definition: FlowDefinitionGateway & FlowMetadataGateway;
  debug: FlowDebugGateway;
  benchmark: FlowBenchmarkSessionGateway;
}

interface BenchmarkExecutionContext {
  request: FlowBenchmarkRequest;
  prepared: PreparedDebug;
  inputs: JsonObject[];
  rawLogStage: string | null;
  progress: FlowProgressReporter;
}

interface BenchmarkPhases {
  completed: CompletedBenchmarkSample[];
  measuredWallClockMilliseconds: number;
}

function rollbackRequest(request: FlowBenchmarkRequest, input: JsonObject): FlowRollbackRequest {
  return {
    apiName: request.apiName,
    targetOrg: request.targetOrg,
    input,
    dryRun: request.dryRun,
    confirm: request.confirm,
    logLevel: request.logLevel,
    showValues: false,
    waitMilliseconds: request.waitMilliseconds,
    ...(request.namespace === undefined ? {} : { namespace: request.namespace }),
    ...(request.expectedActiveVersion === undefined ? {} : { expectedActiveVersion: request.expectedActiveVersion }),
  };
}

function validateInputs(prepared: PreparedDebug, request: FlowBenchmarkRequest): JsonObject[] {
  const description = analyseFlowMetadata({ ...prepared.flow, depth: 0 });
  const inputs = validateFlowInputs(request.inputs, description.variables);
  for (const input of inputs) {
    createBoundedFlowDebugApex({
      correlationId: '00000000-0000-0000-0000-000000000000',
      apiName: prepared.flow.definition.apiName,
      namespace: prepared.flow.definition.namespace,
      input,
      outputVariables: prepared.outputVariables,
    });
  }
  return inputs;
}

function requiredInput(inputs: JsonObject[], index: number): JsonObject {
  const input = inputs[index];
  if (input === undefined) {
    throw flowInputInvalid('Flow benchmark input assignment was out of range.');
  }
  return input;
}

function firstBenchmarkInput(request: FlowBenchmarkRequest): JsonObject {
  assertBenchmarkWorkload({
    iterations: request.iterations,
    warmup: request.warmup,
    concurrency: request.concurrency,
    inputCount: request.inputs.length,
  });
  const firstInput = request.inputs[0];
  if (firstInput === undefined) {
    throw flowInputInvalid('Flow benchmark requires at least one input object.');
  }
  return firstInput;
}

function dryRunArtifact(context: BenchmarkExecutionContext): FlowBenchmarkArtifact {
  return {
    result: createFlowBenchmarkResult({
      request: context.request,
      prepared: context.prepared,
      samples: [],
      totalWallClockMilliseconds: 0,
      measuredWallClockMilliseconds: 0,
    }),
    rawLogStage: null,
  };
}

function traceDuration(request: FlowBenchmarkRequest): number {
  const batches = Math.ceil((request.iterations + request.warmup) / FLOW_BENCHMARK_BATCH_SIZE);
  const plannedDuration = Math.max(request.waitMilliseconds + 60_000, batches * 60_000);
  return Math.min(MAXIMUM_TRACE_DURATION_MILLISECONDS, Math.max(MINIMUM_TRACE_DURATION_MILLISECONDS, plannedDuration));
}

async function assertActiveVersionUnchanged(
  gateway: FlowDefinitionGateway,
  prepared: PreparedDebug,
  stage: 'before' | 'after'
): Promise<void> {
  const expected = prepared.flow;
  const lookup =
    expected.definition.namespace === null
      ? { apiName: expected.definition.apiName }
      : { apiName: expected.definition.apiName, namespace: expected.definition.namespace };
  const current = selectFlowDefinition(expected.definition.apiName, await gateway.findDefinitions(lookup));
  if (current.activeVersionId !== expected.version.id) {
    throw flowBenchmarkFailed(
      `Flow "${qualifiedFlowName(
        expected.definition.apiName,
        expected.definition.namespace
      )}" active version changed ${stage} measured sampling.`
    );
  }
}

async function runPhases(
  context: BenchmarkExecutionContext,
  session: FlowBenchmarkSession,
  definition: FlowDefinitionGateway
): Promise<BenchmarkPhases> {
  const shared = {
    session,
    prepared: context.prepared,
    request: context.request,
    inputs: context.inputs,
    rawLogStage: context.rawLogStage,
    progress: context.progress,
  };
  const warmup = await new FlowBenchmarkPhaseRunner({
    ...shared,
    phase: 'warmup',
    count: context.request.warmup,
  }).run();
  if (warmup.stopped && !context.request.continueOnError) {
    return { completed: warmup.completed, measuredWallClockMilliseconds: 0 };
  }
  await assertActiveVersionUnchanged(definition, context.prepared, 'before');
  const measured = await new FlowBenchmarkPhaseRunner({
    ...shared,
    phase: 'measured',
    count: context.request.iterations,
  }).run();
  await assertActiveVersionUnchanged(definition, context.prepared, 'after');
  return {
    completed: [...warmup.completed, ...measured.completed].sort(
      (left, right) =>
        Number(left.sample.phase === 'measured') - Number(right.sample.phase === 'measured') ||
        left.sample.sample - right.sample.sample
    ),
    measuredWallClockMilliseconds: measured.elapsedMilliseconds,
  };
}

export class FlowBenchmarkService {
  public constructor(private readonly gateways: FlowBenchmarkGateways) {}

  public async benchmark(
    request: FlowBenchmarkRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowBenchmarkArtifact> {
    const context = await this.prepare(request, progress);
    return request.dryRun ? dryRunArtifact(context) : this.withRawLogStage(context);
  }

  private async prepare(
    request: FlowBenchmarkRequest,
    progress: FlowProgressReporter
  ): Promise<BenchmarkExecutionContext> {
    const firstInput = firstBenchmarkInput(request);
    const debug = new FlowDebugService({ definition: this.gateways.definition, debug: this.gateways.debug });
    const prepared = await debug.prepare(rollbackRequest(request, firstInput), progress);
    const inputs = validateInputs(prepared, request);
    return { request, prepared, inputs, rawLogStage: null, progress };
  }

  private async withRawLogStage(context: BenchmarkExecutionContext): Promise<FlowBenchmarkArtifact> {
    const { request, prepared } = context;
    const rawLogStage = await createFlowBenchmarkLogStage(request.rawLogDirectory);
    try {
      return await this.execute({ ...context, rawLogStage });
    } catch (error: unknown) {
      await discardFlowBenchmarkLogStage(rawLogStage);
      if (error instanceof Error && error.name === 'FlowBenchmarkFailed') {
        throw error;
      }
      throw flowBenchmarkFailed(`Flow benchmark "${prepared.flow.apiName}" failed.`, error);
    }
  }

  private async execute(context: BenchmarkExecutionContext): Promise<FlowBenchmarkArtifact> {
    const { request, prepared, inputs } = context;
    const session = await this.gateways.benchmark.open({
      apiName: prepared.flow.definition.apiName,
      namespace: prepared.flow.definition.namespace,
      input: requiredInput(inputs, 0),
      outputVariables: prepared.outputVariables,
      logLevel: request.logLevel,
      waitMilliseconds: request.waitMilliseconds,
      traceDurationMilliseconds: traceDuration(request),
    });
    const started = performance.now();
    try {
      const phases = await runPhases(context, session, this.gateways.definition);
      return {
        result: createFlowBenchmarkResult({
          request,
          prepared,
          samples: phases.completed.map((entry) => entry.sample),
          totalWallClockMilliseconds: performance.now() - started,
          measuredWallClockMilliseconds: phases.measuredWallClockMilliseconds,
        }),
        rawLogStage: context.rawLogStage,
      };
    } finally {
      await session.close();
    }
  }
}
