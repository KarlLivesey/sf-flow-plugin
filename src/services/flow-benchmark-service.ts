/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { resolve } from 'node:path';

import { flowBenchmarkFailed, flowInputInvalid } from '../errors/flow-errors.js';
import type { FlowMetadataGateway, JsonObject } from '../types/flow-analysis.js';
import type { FlowBenchmarkArtifact, FlowBenchmarkGateway, FlowBenchmarkRequest } from '../types/flow-benchmark.js';
import type { FlowDebugGateway } from '../types/flow-debug.js';
import type { FlowRollbackRequest } from '../types/flow-invocation.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import {
  createFlowBenchmarkLogStage,
  createFlowBenchmarkRawLogWriter,
  discardFlowBenchmarkLogStage,
  type FlowBenchmarkRawLogWriter,
} from '../utils/flow-benchmark-files.js';
import { assertBenchmarkSampleTimeout, assertBenchmarkWorkload } from '../utils/flow-benchmark-flags.js';
import { createFlowBenchmarkResult } from '../utils/flow-benchmark-result.js';
import type { CompletedBenchmarkSample } from '../utils/flow-benchmark-sample.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowInputs } from '../utils/flow-input-schema.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';
import { FlowDebugService, type PreparedDebug } from './flow-debug-service.js';
import { FlowBenchmarkPhaseRunner } from './flow-benchmark-phase-runner.js';

interface FlowBenchmarkGateways {
  definition: FlowDefinitionGateway & FlowMetadataGateway;
  debug: FlowDebugGateway;
  benchmark: FlowBenchmarkGateway;
}

export interface FlowBenchmarkLogStage {
  create(directory: string | undefined): Promise<string | null>;
  discard(stage: string | null): Promise<void>;
}

const defaultLogStage: FlowBenchmarkLogStage = {
  create: createFlowBenchmarkLogStage,
  discard: discardFlowBenchmarkLogStage,
};

interface BenchmarkExecutionContext {
  request: FlowBenchmarkRequest;
  prepared: PreparedDebug;
  inputs: JsonObject[];
  rawLogStage: string | null;
  rawLogWriter: FlowBenchmarkRawLogWriter;
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
    waitMilliseconds: request.sampleTimeoutMilliseconds,
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

function firstBenchmarkInput(request: FlowBenchmarkRequest): JsonObject {
  assertBenchmarkWorkload({
    iterations: request.iterations,
    warmup: request.warmup,
    concurrency: request.concurrency,
    inputCount: request.inputs.length,
  });
  assertBenchmarkSampleTimeout(request.sampleTimeoutMilliseconds);
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

function orderedSamples(samples: ReadonlyArray<CompletedBenchmarkSample>): CompletedBenchmarkSample[] {
  return [...samples].sort(
    (left, right) =>
      Number(left.sample.phase === 'measured') - Number(right.sample.phase === 'measured') ||
      left.sample.sample - right.sample.sample
  );
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
  benchmark: FlowBenchmarkGateway,
  definition: FlowDefinitionGateway
): Promise<BenchmarkPhases> {
  const shared = {
    benchmark,
    prepared: context.prepared,
    request: context.request,
    inputs: context.inputs,
    rawLogWriter: context.rawLogWriter,
    progress: context.progress,
  };
  const warmup = await new FlowBenchmarkPhaseRunner({
    ...shared,
    phase: 'warmup',
    count: context.request.warmup,
  }).run();
  if (warmup.stopped) {
    return { completed: orderedSamples(warmup.completed), measuredWallClockMilliseconds: 0 };
  }
  await assertActiveVersionUnchanged(definition, context.prepared, 'before');
  const measured = await new FlowBenchmarkPhaseRunner({
    ...shared,
    phase: 'measured',
    count: context.request.iterations,
  }).run();
  await assertActiveVersionUnchanged(definition, context.prepared, 'after');
  return {
    completed: orderedSamples([...warmup.completed, ...measured.completed]),
    measuredWallClockMilliseconds: measured.elapsedMilliseconds,
  };
}

async function handleBenchmarkFailure(context: {
  logStage: FlowBenchmarkLogStage;
  rawLogStage: string | null;
  apiName: string;
  error: unknown;
}): Promise<never> {
  const cleanupError = await context.logStage.discard(context.rawLogStage).then(
    () => null,
    (caught: unknown) => caught
  );
  if (cleanupError !== null) {
    const retained = context.rawLogStage === null ? 'unknown' : resolve(context.rawLogStage);
    throw flowBenchmarkFailed(
      `Flow benchmark "${context.apiName}" failed and raw-log staging cleanup also failed. Recoverable staging data was retained at "${retained}".`,
      context.error
    );
  }
  if (context.error instanceof Error && context.error.name === 'FlowBenchmarkFailed') {
    throw context.error;
  }
  throw flowBenchmarkFailed(`Flow benchmark "${context.apiName}" failed.`, context.error);
}

export class FlowBenchmarkService {
  public constructor(
    private readonly gateways: FlowBenchmarkGateways,
    private readonly logStage: FlowBenchmarkLogStage = defaultLogStage
  ) {}

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
    return {
      request,
      prepared,
      inputs,
      rawLogStage: null,
      rawLogWriter: createFlowBenchmarkRawLogWriter(null),
      progress,
    };
  }

  private async withRawLogStage(context: BenchmarkExecutionContext): Promise<FlowBenchmarkArtifact> {
    const { request, prepared } = context;
    let rawLogStage: string | null = null;
    try {
      rawLogStage = await this.logStage.create(request.rawLogDirectory);
      return await this.execute({
        ...context,
        rawLogStage,
        rawLogWriter: createFlowBenchmarkRawLogWriter(rawLogStage),
      });
    } catch (error: unknown) {
      return handleBenchmarkFailure({
        logStage: this.logStage,
        rawLogStage,
        apiName: prepared.flow.apiName,
        error,
      });
    }
  }

  private async execute(context: BenchmarkExecutionContext): Promise<FlowBenchmarkArtifact> {
    const { request, prepared } = context;
    const started = performance.now();
    const phases = await runPhases(context, this.gateways.benchmark, this.gateways.definition);
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
  }
}
