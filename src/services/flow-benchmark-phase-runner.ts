/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowBenchmarkGateway, FlowBenchmarkPhase, FlowBenchmarkRequest } from '../types/flow-benchmark.js';
import { FlowBenchmarkExecutionError } from '../utils/flow-benchmark-error.js';
import { writeFlowBenchmarkRawLogs, type FlowBenchmarkRawLog } from '../utils/flow-benchmark-files.js';
import {
  completedBenchmarkSample,
  type CompletedBenchmarkSample,
  failedBenchmarkSample,
  type PlannedBenchmarkSample,
  safeBenchmarkErrorCode,
} from '../utils/flow-benchmark-sample.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import type { PreparedDebug } from './flow-debug-service.js';

export interface FlowBenchmarkPhaseResult {
  completed: CompletedBenchmarkSample[];
  stopped: boolean;
  elapsedMilliseconds: number;
}

export interface FlowBenchmarkPhaseRunnerContext {
  benchmark: FlowBenchmarkGateway;
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
    return this.runNextWave(0);
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
    return completed;
  }

  private async measure(planned: PlannedBenchmarkSample): Promise<CompletedBenchmarkSample> {
    try {
      const transport = await this.context.benchmark.execute({
        apiName: this.context.prepared.flow.definition.apiName,
        namespace: this.context.prepared.flow.definition.namespace,
        input: planned.input,
        outputVariables: this.context.prepared.outputVariables,
        logLevel: this.context.request.logLevel,
      });
      return completedBenchmarkSample(planned, transport);
    } catch (error: unknown) {
      return failedBenchmarkSample(planned, {
        wallClockMilliseconds:
          error instanceof FlowBenchmarkExecutionError ? error.executionDurationMilliseconds : null,
        errorCode: safeBenchmarkErrorCode(error),
        errorMessage:
          error instanceof FlowBenchmarkExecutionError
            ? error.safeMessage
            : 'The benchmark sample failed before Salesforce returned a validated result.',
        rawLog: error instanceof FlowBenchmarkExecutionError ? error.rawLog : null,
      });
    }
  }

  private orderedCompleted(): CompletedBenchmarkSample[] {
    return [...this.completed].sort((left, right) => left.sample.sample - right.sample.sample);
  }

  private async retainRawLogs(completed: ReadonlyArray<CompletedBenchmarkSample>): Promise<void> {
    const logs = completed.flatMap((entry): FlowBenchmarkRawLog[] => {
      const rawLog = entry.rawLog;
      const retain =
        rawLog !== null &&
        this.context.rawLogStage !== null &&
        (entry.sample.phase === 'measured' || this.context.request.retainWarmupLogs);
      return retain ? [{ phase: entry.sample.phase, sample: entry.sample.sample, rawLog }] : [];
    });
    for (const completedEntry of completed) {
      completedEntry.rawLog = null;
    }
    if (this.context.rawLogStage !== null) {
      await writeFlowBenchmarkRawLogs(this.context.rawLogStage, logs);
    }
  }

  private async runNextWave(elapsedMilliseconds: number): Promise<FlowBenchmarkPhaseResult> {
    if (this.stopped || this.nextIndex >= this.context.count) {
      return { completed: this.orderedCompleted(), stopped: this.stopped, elapsedMilliseconds };
    }
    const waveEnd = Math.min(this.context.count, this.nextIndex + this.context.request.concurrency);
    const started = performance.now();
    const completed = await this.runWave(waveEnd);
    const measuredMilliseconds = performance.now() - started;
    await this.retainRawLogs(completed);
    return this.runNextWave(elapsedMilliseconds + measuredMilliseconds);
  }

  private async runWave(waveEnd: number): Promise<CompletedBenchmarkSample[]> {
    const firstCompletedIndex = this.completed.length;
    const workerCount = Math.min(this.context.request.concurrency, waveEnd - this.nextIndex);
    const settled = await Promise.allSettled(Array.from({ length: workerCount }, async () => this.worker(waveEnd)));
    const failure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure !== undefined) {
      this.stopped = true;
      throw failure.reason;
    }
    return this.completed.slice(firstCompletedIndex);
  }

  private async worker(waveEnd: number): Promise<void> {
    const planned = this.claim(waveEnd);
    if (planned === null) {
      return;
    }
    const completed = await this.execute(planned);
    this.completed.push(completed);
    if (!completed.sample.successful && !this.context.request.continueOnError) {
      this.stopped = true;
    }
  }
}
