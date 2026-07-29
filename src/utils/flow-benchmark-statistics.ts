/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowBenchmarkStatistics } from '../types/flow-benchmark.js';

function requiredValue(values: ReadonlyArray<number>, index: number): number {
  const value = values.at(index);
  if (value === undefined) {
    throw new RangeError('Benchmark statistics require at least one value.');
  }
  return value;
}

function nearestRank(sorted: ReadonlyArray<number>, percentile: number): number {
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length));
  return requiredValue(sorted, rank - 1);
}

export function calculateBenchmarkStatistics(
  values: ReadonlyArray<number>,
  percentiles: ReadonlyArray<number>
): FlowBenchmarkStatistics | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    minimum: requiredValue(sorted, 0),
    maximum: requiredValue(sorted, -1),
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    percentiles: percentiles.map((percentile) => ({
      percentile,
      value: nearestRank(sorted, percentile),
    })),
  };
}
