/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { flowBenchmarkFailed } from '../errors/flow-errors.js';
import type { FlowBenchmarkRequest, FlowBenchmarkResult } from '../types/flow-benchmark.js';
import { fingerprintBenchmarkInputs } from './flow-benchmark-fingerprint.js';

const statisticsSchema = z
  .object({
    percentiles: z.array(z.object({ percentile: z.number().gt(0).max(100), value: z.number().finite().nonnegative() })),
  })
  .nullable();
const baselineSchema = z.object({
  apiName: z.string(),
  namespace: z.string().nullable(),
  targetOrg: z.string(),
  version: z.number().int().positive(),
  successful: z.literal(true),
  dryRun: z.literal(false),
  interrupted: z.literal(false),
  inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  includeFailed: z.boolean(),
  logLevel: z.enum(['detailed', 'finest']),
  requestedConcurrency: z.number().int().positive(),
  iterations: z.number().int().positive(),
  warmup: z.number().int().nonnegative(),
  sampleTimeoutMilliseconds: z.number().positive(),
  wallClock: statisticsSchema,
  cpuTime: statisticsSchema,
});
const documentSchema = z.union([
  baselineSchema,
  z
    .object({ status: z.literal(0), result: baselineSchema, warnings: z.array(z.unknown()) })
    .transform(({ result }) => result),
]);
export type BenchmarkBaseline = z.infer<typeof baselineSchema>;

export interface BenchmarkComparison {
  metric: 'cpu' | 'wall-clock';
  percentile: number;
  baselineVersion: number;
  baselineValue: number;
  currentValue: number | null;
  regressionPercent: number | null;
  maximumRegressionPercent: number | null;
  exceeded: boolean | null;
}

export function parseRegressionPercent(value: string): number {
  const parsed = z.coerce.number().finite().nonnegative().safeParse(value);
  if (value.trim() === '' || !parsed.success) {
    throw flowBenchmarkFailed('--max-regression must be a finite nonnegative percentage.');
  }
  return parsed.data;
}

function measurement(
  result: { cpuTime: z.infer<typeof statisticsSchema>; wallClock: z.infer<typeof statisticsSchema> },
  metric: 'cpu' | 'wall-clock',
  percentile: number
): number | null {
  const statistics = metric === 'cpu' ? result.cpuTime : result.wallClock;
  return statistics?.percentiles.find((entry) => entry.percentile === percentile)?.value ?? null;
}

export async function readBenchmarkBaseline(file: string | undefined): Promise<BenchmarkBaseline | undefined> {
  if (file === undefined) {
    return undefined;
  }
  try {
    return documentSchema.parse(JSON.parse(await readFile(file, 'utf8')) as unknown);
  } catch (error: unknown) {
    throw flowBenchmarkFailed(
      'Baseline must be a complete successful benchmark result with input fingerprint and measurement settings.',
      error
    );
  }
}

/** Fail before invocation when inputs or measurement settings would make a comparison misleading. */
export function assertBenchmarkComparable(
  baseline: BenchmarkBaseline | undefined,
  request: FlowBenchmarkRequest
): void {
  if (baseline === undefined) {
    return;
  }
  const expected = {
    targetOrg: request.targetOrg,
    inputFingerprint: fingerprintBenchmarkInputs(request.inputs),
    includeFailed: request.includeFailed,
    logLevel: request.logLevel,
    requestedConcurrency: request.concurrency,
    iterations: request.iterations,
    warmup: request.warmup,
    sampleTimeoutMilliseconds: request.sampleTimeoutMilliseconds,
  };
  const differences = Object.entries(expected)
    .filter(([key, value]) => Reflect.get(baseline, key) !== value)
    .map(([key]) => key);
  if (differences.length > 0) {
    throw flowBenchmarkFailed(`Benchmark baseline has incompatible settings: ${differences.join(', ')}.`);
  }
}

export function compareBenchmark(
  result: FlowBenchmarkResult,
  baseline: BenchmarkBaseline,
  selection: { metric: 'cpu' | 'wall-clock'; percentile: number; maximum: number | undefined }
): BenchmarkComparison {
  if (result.apiName !== baseline.apiName || result.namespace !== baseline.namespace) {
    throw flowBenchmarkFailed('Benchmark baseline belongs to a different qualified Flow.');
  }
  const before = measurement(baseline, selection.metric, selection.percentile);
  if (before === null) {
    throw flowBenchmarkFailed('The baseline does not contain the selected metric percentile.');
  }
  const current =
    result.dryRun || result.successful !== true ? null : measurement(result, selection.metric, selection.percentile);
  const percent = current === null || before === 0 ? null : ((current - before) / before) * 100;
  return {
    metric: selection.metric,
    percentile: selection.percentile,
    baselineVersion: baseline.version,
    baselineValue: before,
    currentValue: current,
    regressionPercent: percent,
    maximumRegressionPercent: selection.maximum ?? null,
    exceeded:
      current === null || selection.maximum === undefined
        ? null
        : before === 0
        ? current > 0
        : (percent ?? 0) > selection.maximum,
  };
}
