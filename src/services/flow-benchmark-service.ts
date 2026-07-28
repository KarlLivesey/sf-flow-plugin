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
  FlowBenchmarkPhase,
  FlowBenchmarkRequest,
  FlowBenchmarkSession,
  FlowBenchmarkSessionGateway,
} from '../types/flow-benchmark.js';
import type { FlowDebugGateway } from '../types/flow-debug.js';
import type { FlowRollbackRequest } from '../types/flow-invocation.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import { createBoundedFlowDebugApex } from '../utils/flow-debug-apex.js';
import { createFlowBenchmarkResult } from '../utils/flow-benchmark-result.js';
import {
  completedBenchmarkSample,
  type CompletedBenchmarkSample,
  failedBenchmarkSample,
  type PlannedBenchmarkSample,
  safeBenchmarkErrorCode,
} from '../utils/flow-benchmark-sample.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { validateFlowInputs } from '../utils/flow-input-schema.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDebugService, type PreparedDebug } from './flow-debug-service.js';

interface FlowBenchmarkGateways {
  definition: FlowDefinitionGateway & FlowMetadataGateway;
  debug: FlowDebugGateway;
  benchmark: FlowBenchmarkSessionGateway;
}

interface PhaseResult {
  completed: CompletedBenchmarkSample[];
  stopped: boolean;
}

interface PhaseRunnerContext {
  session: FlowBenchmarkSession;
  prepared: PreparedDebug;
  request: FlowBenchmarkRequest;
  progress: FlowProgressReporter;
}

interface BenchmarkExecutionContext {
  request: FlowBenchmarkRequest;
  prepared: PreparedDebug;
  inputs: JsonObject[];
  progress: FlowProgressReporter;
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

function planPhase(phase: FlowBenchmarkPhase, count: number, inputs: JsonObject[]): PlannedBenchmarkSample[] {
  return Array.from({ length: count }, (_, index) => ({
    sample: index + 1,
    phase,
    inputIndex: index % inputs.length,
    input: requiredInput(inputs, index % inputs.length),
  }));
}

class BenchmarkPhaseRunner {
  private readonly completed: CompletedBenchmarkSample[] = [];
  private nextIndex = 0;
  private stopped = false;

  public constructor(
    private readonly context: PhaseRunnerContext,
    private readonly planned: PlannedBenchmarkSample[]
  ) {}

  public async run(): Promise<PhaseResult> {
    const workerCount = Math.min(this.context.request.concurrency, this.planned.length);
    await Promise.all(Array.from({ length: workerCount }, async () => this.worker()));
    return { completed: this.completed, stopped: this.stopped };
  }

  private claim(): PlannedBenchmarkSample | null {
    if (this.stopped || this.nextIndex >= this.planned.length) {
      return null;
    }
    const planned = this.planned[this.nextIndex];
    if (planned === undefined) {
      return null;
    }
    this.nextIndex += 1;
    return planned;
  }

  private async execute(planned: PlannedBenchmarkSample): Promise<CompletedBenchmarkSample> {
    this.context.progress(
      'invoking-flow',
      `${this.context.prepared.flow.apiName} ${planned.phase} ${planned.sample}/${this.planned.length}`
    );
    const started = performance.now();
    try {
      const transport = await this.context.session.execute({
        apiName: this.context.prepared.flow.definition.apiName,
        namespace: this.context.prepared.flow.definition.namespace,
        input: planned.input,
        outputVariables: this.context.prepared.outputVariables,
        logLevel: this.context.request.logLevel,
        waitMilliseconds: this.context.request.waitMilliseconds,
      });
      return completedBenchmarkSample(planned, transport);
    } catch (error: unknown) {
      return failedBenchmarkSample(planned, {
        wallClockMilliseconds: performance.now() - started,
        errorCode: safeBenchmarkErrorCode(error),
      });
    }
  }

  private async worker(): Promise<void> {
    const planned = this.claim();
    if (planned === null) {
      return;
    }
    const completed = await this.execute(planned);
    this.completed.push(completed);
    if (!completed.sample.successful && !this.context.request.continueOnError) {
      this.stopped = true;
      return;
    }
    await this.worker();
  }
}

async function runPhases(
  context: BenchmarkExecutionContext,
  session: FlowBenchmarkSession
): Promise<CompletedBenchmarkSample[]> {
  const { request, prepared, inputs, progress } = context;
  const runnerContext = { session, prepared, request, progress };
  const warmup = await new BenchmarkPhaseRunner(runnerContext, planPhase('warmup', request.warmup, inputs)).run();
  const measured =
    warmup.stopped && !request.continueOnError
      ? { completed: [], stopped: true }
      : await new BenchmarkPhaseRunner(runnerContext, planPhase('measured', request.iterations, inputs)).run();
  return [...warmup.completed, ...measured.completed].sort(
    (left, right) =>
      Number(left.sample.phase === 'measured') - Number(right.sample.phase === 'measured') ||
      left.sample.sample - right.sample.sample
  );
}

export class FlowBenchmarkService {
  public constructor(private readonly gateways: FlowBenchmarkGateways) {}

  public async benchmark(
    request: FlowBenchmarkRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowBenchmarkArtifact> {
    const firstInput = request.inputs[0];
    if (firstInput === undefined) {
      throw flowInputInvalid('Flow benchmark requires at least one input object.');
    }
    const debug = new FlowDebugService({ definition: this.gateways.definition, debug: this.gateways.debug });
    const prepared = await debug.prepare(rollbackRequest(request, firstInput), progress);
    const inputs = validateInputs(prepared, request);
    if (request.dryRun) {
      return {
        result: createFlowBenchmarkResult({ request, prepared, samples: [], totalWallClockMilliseconds: 0 }),
        rawLogs: [],
      };
    }
    return this.execute({ request, prepared, inputs, progress });
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
    });
    const started = performance.now();
    try {
      const completed = await runPhases(context, session);
      const result = createFlowBenchmarkResult({
        request,
        prepared,
        samples: completed.map((entry) => entry.sample),
        totalWallClockMilliseconds: performance.now() - started,
      });
      return {
        result,
        rawLogs: completed.flatMap((entry) => (entry.rawLog === null ? [] : [entry.rawLog])),
      };
    } catch (error: unknown) {
      throw flowBenchmarkFailed(`Flow benchmark "${prepared.flow.apiName}" failed.`, error);
    } finally {
      await session.close();
    }
  }
}
