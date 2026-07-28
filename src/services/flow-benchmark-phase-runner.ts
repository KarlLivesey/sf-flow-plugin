/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowBenchmarkPhase, FlowBenchmarkRequest, FlowBenchmarkSession } from '../types/flow-benchmark.js';
import { FlowBenchmarkExecutionError } from '../utils/flow-benchmark-error.js';
import { writeFlowBenchmarkRawLog } from '../utils/flow-benchmark-files.js';
import {
  completedBenchmarkSample,
  type CompletedBenchmarkSample,
  failedBenchmarkSample,
  type PlannedBenchmarkSample,
  safeBenchmarkErrorCode,
} from '../utils/flow-benchmark-sample.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import type { PreparedDebug } from './flow-debug-service.js';

export const FLOW_BENCHMARK_BATCH_SIZE = 100;

export interface FlowBenchmarkPhaseResult {
  completed: CompletedBenchmarkSample[];
  stopped: boolean;
  elapsedMilliseconds: number;
}

export interface FlowBenchmarkPhaseRunnerContext {
  session: FlowBenchmarkSession;
  prepared: PreparedDebug;
  request: FlowBenchmarkRequest;
  inputs: JsonObject[];
  phase: FlowBenchmarkPhase;
  count: number;
  rawLogStage: string | null;
  progress: FlowProgressReporter;
}

function requiredInput(inputs: JsonObject[], index: number): JsonObject {
  const input = inputs[index];
  if (input === undefined) {
    throw new RangeError('Flow benchmark input assignment was out of range.');
  }
  return input;
}

function plannedSample(context: FlowBenchmarkPhaseRunnerContext, index: number): PlannedBenchmarkSample {
  const inputIndex = index % context.inputs.length;
  return {
    sample: index + 1,
    phase: context.phase,
    inputIndex,
    input: requiredInput(context.inputs, inputIndex),
  };
}

export class FlowBenchmarkPhaseRunner {
  private readonly completed: CompletedBenchmarkSample[] = [];
  private nextIndex = 0;
  private stopped = false;

  public constructor(private readonly context: FlowBenchmarkPhaseRunnerContext) {}

  public async run(): Promise<FlowBenchmarkPhaseResult> {
    return this.runNextBatch(0);
  }

  private claim(batchEnd: number): PlannedBenchmarkSample | null {
    if (this.stopped || this.nextIndex >= batchEnd) {
      return null;
    }
    const index = this.nextIndex;
    this.nextIndex += 1;
    return plannedSample(this.context, index);
  }

  private async execute(planned: PlannedBenchmarkSample): Promise<CompletedBenchmarkSample> {
    this.context.progress(
      'invoking-flow',
      `${this.context.prepared.flow.apiName} ${planned.phase} ${planned.sample}/${this.context.count}`
    );
    const completed = await this.measure(planned);
    await this.retainRawLog(planned, completed);
    completed.rawLog = null;
    return completed;
  }

  private async measure(planned: PlannedBenchmarkSample): Promise<CompletedBenchmarkSample> {
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
        wallClockMilliseconds:
          error instanceof FlowBenchmarkExecutionError ? error.executionDurationMilliseconds : null,
        errorCode: safeBenchmarkErrorCode(error),
      });
    }
  }

  private async retainRawLog(planned: PlannedBenchmarkSample, completed: CompletedBenchmarkSample): Promise<void> {
    if (
      completed.rawLog !== null &&
      this.context.rawLogStage !== null &&
      (planned.phase === 'measured' || this.context.request.retainWarmupLogs)
    ) {
      await writeFlowBenchmarkRawLog(this.context.rawLogStage, {
        phase: planned.phase,
        sample: planned.sample,
        rawLog: completed.rawLog,
      });
    }
  }

  private async runBatch(batchEnd: number): Promise<void> {
    const workerCount = Math.min(this.context.request.concurrency, batchEnd - this.nextIndex);
    await Promise.all(Array.from({ length: workerCount }, async () => this.worker(batchEnd)));
  }

  private async runNextBatch(elapsedMilliseconds: number): Promise<FlowBenchmarkPhaseResult> {
    if (this.stopped || this.nextIndex >= this.context.count) {
      return { completed: this.completed, stopped: this.stopped, elapsedMilliseconds };
    }
    await this.context.session.prepareBatch();
    const batchEnd = Math.min(this.context.count, this.nextIndex + FLOW_BENCHMARK_BATCH_SIZE);
    const started = performance.now();
    await this.runBatch(batchEnd);
    return this.runNextBatch(elapsedMilliseconds + performance.now() - started);
  }

  private async worker(batchEnd: number): Promise<void> {
    const planned = this.claim(batchEnd);
    if (planned === null) {
      return;
    }
    const completed = await this.execute(planned);
    this.completed.push(completed);
    if (!completed.sample.successful && !this.context.request.continueOnError) {
      this.stopped = true;
      return;
    }
    await this.worker(batchEnd);
  }
}
