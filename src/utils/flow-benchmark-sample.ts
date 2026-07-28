/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type {
  FlowBenchmarkPhase,
  FlowBenchmarkRawLog,
  FlowBenchmarkSample,
  FlowBenchmarkTransportSample,
} from '../types/flow-benchmark.js';
import { parseFlowDebugLog } from './flow-debug-log.js';
import { parseApexCpuTime } from './flow-benchmark-log.js';

export interface PlannedBenchmarkSample {
  sample: number;
  phase: FlowBenchmarkPhase;
  inputIndex: number;
  input: JsonObject;
}

export interface CompletedBenchmarkSample {
  sample: FlowBenchmarkSample;
  rawLog: FlowBenchmarkRawLog | null;
}

interface FailedSampleContext {
  wallClockMilliseconds: number;
  errorCode: string;
  apexLogId?: string;
}

export function safeBenchmarkErrorCode(error: unknown): string {
  return error instanceof Error && /^Flow[A-Z][A-Za-z]+$/u.test(error.name) ? error.name : 'FlowBenchmarkFailed';
}

export function failedBenchmarkSample(
  planned: PlannedBenchmarkSample,
  context: FailedSampleContext
): CompletedBenchmarkSample {
  return {
    sample: {
      sample: planned.sample,
      phase: planned.phase,
      inputIndex: planned.inputIndex,
      successful: false,
      rollbackConfirmed: false,
      wallClockMilliseconds: context.wallClockMilliseconds,
      cpuTimeMilliseconds: null,
      apexLogId: context.apexLogId ?? null,
      errorCode: context.errorCode,
    },
    rawLog: null,
  };
}

export function completedBenchmarkSample(
  planned: PlannedBenchmarkSample,
  transportSample: FlowBenchmarkTransportSample
): CompletedBenchmarkSample {
  const { transport } = transportSample;
  try {
    const parsed = parseFlowDebugLog(transport.rawLog, transport.correlationId, false);
    const complete = parsed.beginMarker && parsed.endMarker && (parsed.outputMarker || parsed.error !== null);
    const rollbackConfirmed = parsed.rollbackMarker;
    const successful = transport.execution.success && parsed.error === null && complete && rollbackConfirmed;
    return {
      sample: {
        sample: planned.sample,
        phase: planned.phase,
        inputIndex: planned.inputIndex,
        successful,
        rollbackConfirmed,
        wallClockMilliseconds: transportSample.wallClockMilliseconds,
        cpuTimeMilliseconds: parseApexCpuTime(transport.rawLog),
        apexLogId: transport.log.id,
        errorCode:
          parsed.error?.type ??
          (successful ? null : rollbackConfirmed ? 'FlowBenchmarkSampleFailed' : 'FlowDebugRollbackFailed'),
      },
      rawLog: { sample: planned.sample, phase: planned.phase, rawLog: transport.rawLog },
    };
  } catch {
    const failed = failedBenchmarkSample(planned, {
      wallClockMilliseconds: transportSample.wallClockMilliseconds,
      errorCode: 'FlowDebugFailed',
      apexLogId: transport.log.id,
    });
    return {
      ...failed,
      rawLog: { sample: planned.sample, phase: planned.phase, rawLog: transport.rawLog },
    };
  }
}
