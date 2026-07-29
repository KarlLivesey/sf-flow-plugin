/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowBenchmarkPhase, FlowBenchmarkSample, FlowBenchmarkTransportSample } from '../types/flow-benchmark.js';
import { FlowBenchmarkExecutionError } from './flow-benchmark-error.js';
import { safeFlowDiagnostic } from './flow-diagnostic.js';
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
  rawLog: string | null;
  stopScheduling: boolean;
}

interface FailedSampleContext {
  wallClockMilliseconds: number | null;
  errorCode: string;
  errorMessage: string;
  rawLog?: string | null;
  rollbackConfirmed?: boolean | null;
  stopScheduling?: boolean;
}

function safeCompileMessage(diagnostic: string | null): string {
  const safe = safeFlowDiagnostic(diagnostic);
  return safe === null ? 'Generated Apex could not be compiled.' : `Generated Apex could not be compiled: ${safe}`;
}

export function safeBenchmarkErrorCode(error: unknown): string {
  if (error instanceof FlowBenchmarkExecutionError) {
    return error.errorCode;
  }
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
      rollbackConfirmed: context.rollbackConfirmed === undefined ? false : context.rollbackConfirmed,
      wallClockMilliseconds: context.wallClockMilliseconds,
      cpuTimeMilliseconds: null,
      errorCode: context.errorCode,
      errorMessage: context.errorMessage,
    },
    rawLog: context.rawLog ?? null,
    stopScheduling: context.stopScheduling ?? false,
  };
}

function compileFailure(
  planned: PlannedBenchmarkSample,
  transportSample: FlowBenchmarkTransportSample
): CompletedBenchmarkSample | null {
  const { transport } = transportSample;
  return transport.execution.compiled
    ? null
    : failedBenchmarkSample(planned, {
        wallClockMilliseconds: transportSample.wallClockMilliseconds,
        errorCode: 'APEX_COMPILE_ERROR',
        errorMessage: safeCompileMessage(transport.execution.compileProblem),
        rawLog: transport.rawLog,
      });
}

function runtimeSample(
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
        errorCode:
          parsed.error?.type ??
          (successful ? null : rollbackConfirmed ? 'FlowBenchmarkSampleFailed' : 'FlowDebugRollbackFailed'),
        errorMessage:
          parsed.error?.message ??
          (successful
            ? null
            : transport.execution.success
            ? 'The sample did not contain complete rollback confirmation.'
            : 'Salesforce terminated the benchmark transaction; runtime details were redacted.'),
      },
      rawLog: transport.rawLog,
      stopScheduling: false,
    };
  } catch {
    const failed = failedBenchmarkSample(planned, {
      wallClockMilliseconds: transportSample.wallClockMilliseconds,
      errorCode: 'FlowDebugFailed',
      errorMessage: 'The returned Apex SOAP debug log was malformed or incomplete.',
      rawLog: transport.rawLog,
    });
    return failed;
  }
}

export function completedBenchmarkSample(
  planned: PlannedBenchmarkSample,
  transportSample: FlowBenchmarkTransportSample
): CompletedBenchmarkSample {
  return compileFailure(planned, transportSample) ?? runtimeSample(planned, transportSample);
}
