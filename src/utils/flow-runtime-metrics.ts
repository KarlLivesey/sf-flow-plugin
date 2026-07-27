/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import type {
  FlowRuntimeMetricBreakdown,
  FlowRuntimeMetrics,
  FlowRuntimeMetricsRequest,
} from '../types/flow-metrics.js';

const numericValueSchema = z.union([
  z.number().finite(),
  z
    .string()
    .regex(/^-?\d+(?:\.\d+)?$/)
    .transform(Number),
]);
const countValueSchema = numericValueSchema.pipe(z.number().int().nonnegative().safe());
const nullableDurationValueSchema = numericValueSchema
  .pipe(z.number().nonnegative().finite())
  .nullable()
  .optional()
  .transform((value) => value ?? null);
const nullableTextSchema = z
  .string()
  .nullable()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
  });
const nullableTimestampSchema = nullableTextSchema.refine(
  (value) => value === null || !Number.isNaN(Date.parse(value)),
  'Expected a valid timestamp.'
);

export function parseFlowRuntimeBreakdown(record: Record<string, unknown>): FlowRuntimeMetricBreakdown {
  return {
    status: nullableTextSchema.parse(record.runStatus) ?? 'Unknown',
    errorReason: nullableTextSchema.parse(record.errorReason),
    executions: countValueSchema.parse(record.executions),
    averageDurationMilliseconds: nullableDurationValueSchema.parse(record.averageDurationMilliseconds),
    minimumDurationMilliseconds: nullableDurationValueSchema.parse(record.minimumDurationMilliseconds),
    maximumDurationMilliseconds: nullableDurationValueSchema.parse(record.maximumDurationMilliseconds),
    firstExecution: nullableTimestampSchema.parse(record.firstExecution),
    lastExecution: nullableTimestampSchema.parse(record.lastExecution),
  };
}

function isSuccessful(status: string): boolean {
  return ['complete', 'completed', 'finished', 'success', 'successful'].includes(status.toLowerCase());
}

function isFailed(breakdown: FlowRuntimeMetricBreakdown): boolean {
  return breakdown.errorReason !== null || /error|fail/u.test(breakdown.status.toLowerCase());
}

function weightedAverage(breakdowns: ReadonlyArray<FlowRuntimeMetricBreakdown>): number | null {
  const measured = breakdowns.filter((item) => item.averageDurationMilliseconds !== null);
  const executions = measured.reduce((total, item) => total + item.executions, 0);
  return executions === 0
    ? null
    : measured.reduce((total, item) => total + (item.averageDurationMilliseconds ?? 0) * item.executions, 0) /
        executions;
}

function extreme(
  breakdowns: ReadonlyArray<FlowRuntimeMetricBreakdown>,
  field: 'maximumDurationMilliseconds' | 'minimumDurationMilliseconds',
  select: (...values: number[]) => number
): number | null {
  const values = breakdowns.flatMap((item) => (item[field] === null ? [] : [item[field]]));
  return values.length === 0 ? null : select(...values);
}

function dateExtreme(
  breakdowns: ReadonlyArray<FlowRuntimeMetricBreakdown>,
  field: 'firstExecution' | 'lastExecution',
  direction: 'first' | 'last'
): string | null {
  const values = breakdowns
    .flatMap((item) => (item[field] === null ? [] : [item[field]]))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return values.length === 0 ? null : (direction === 'first' ? values[0] : values.at(-1)) ?? null;
}

export function summariseFlowRuntimeMetrics(
  request: FlowRuntimeMetricsRequest,
  from: string,
  breakdowns: FlowRuntimeMetricBreakdown[]
): FlowRuntimeMetrics {
  return {
    source: 'data-cloud',
    enabled: true,
    apiName: request.apiName,
    namespace: request.namespace,
    version: request.version,
    windowDays: request.windowDays,
    from,
    executions: breakdowns.reduce((total, item) => total + item.executions, 0),
    successfulExecutions: breakdowns
      .filter((item) => isSuccessful(item.status) && !isFailed(item))
      .reduce((total, item) => total + item.executions, 0),
    failedExecutions: breakdowns.filter(isFailed).reduce((total, item) => total + item.executions, 0),
    averageDurationMilliseconds: weightedAverage(breakdowns),
    minimumDurationMilliseconds: extreme(breakdowns, 'minimumDurationMilliseconds', Math.min),
    maximumDurationMilliseconds: extreme(breakdowns, 'maximumDurationMilliseconds', Math.max),
    firstExecution: dateExtreme(breakdowns, 'firstExecution', 'first'),
    lastExecution: dateExtreme(breakdowns, 'lastExecution', 'last'),
    breakdowns,
  };
}
