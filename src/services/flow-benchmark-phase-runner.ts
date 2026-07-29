/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import { flowBenchmarkFailed } from '../errors/flow-errors.js';
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
  private readonly active = new Set<Promise<void>>();
  private nextIndex = 0;
  private stopped = false;
  private failure: unknown;

  public constructor(private readonly context: FlowBenchmarkPhaseRunnerContext) {}

  public async run(): Promise<FlowBenchmarkPhaseResult> {
    const started = performance.now();
    this.fillAvailableSlots();
    await this.drainActive();
    const elapsedMilliseconds = performance.now() - started;
    this.throwWorkerFailure();
    await this.retainRawLogs(this.completed);
    return { completed: this.orderedCompleted(), stopped: this.stopped, elapsedMilliseconds };
  }

  private async drainActive(): Promise<void> {
    while (this.active.size > 0) {
      // Each settlement frees a slot which is replenished immediately.
      // eslint-disable-next-line no-await-in-loop
      await Promise.race(this.active);
      this.fillAvailableSlots();
    }
  }

  private throwWorkerFailure(): void {
    if (this.failure !== undefined) {
      if (this.failure instanceof Error) {
        throw this.failure;
      }
      throw flowBenchmarkFailed('A Flow benchmark worker failed.', this.failure);
    }
  }

  private claim(): PlannedBenchmarkSample | null {
    if (this.stopped || this.nextIndex >= this.context.count) {
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
        rollbackConfirmed: error instanceof FlowBenchmarkExecutionError ? error.rollbackConfirmed : false,
        stopScheduling: error instanceof FlowBenchmarkExecutionError ? error.stopScheduling : false,
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

  private fillAvailableSlots(): void {
    const concurrency = Math.min(this.context.request.concurrency, this.context.count);
    while (!this.stopped && this.nextIndex < this.context.count && this.active.size < concurrency) {
      const planned = this.claim();
      if (planned !== null) {
        this.start(planned);
      }
    }
  }

  private start(planned: PlannedBenchmarkSample): void {
    const active = this.execute(planned)
      .then((completed) => {
        this.completed.push(completed);
        if (completed.stopScheduling || (!completed.sample.successful && !this.context.request.continueOnError)) {
          this.stopped = true;
        }
      })
      .catch((error: unknown) => {
        this.failure ??= error;
        this.stopped = true;
      })
      .finally(() => {
        this.active.delete(active);
      });
    this.active.add(active);
  }
}
