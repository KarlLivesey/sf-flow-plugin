/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInputInvalid } from '../errors/flow-errors.js';

export const MAX_BENCHMARK_ITERATIONS = 10_000;
export const MAX_BENCHMARK_WARMUP = 1000;
export const MAX_BENCHMARK_CONCURRENCY = 100;
export const MAX_BENCHMARK_INPUTS = 10_000;
export const MAX_BENCHMARK_INPUT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BENCHMARK_SAMPLES = MAX_BENCHMARK_ITERATIONS + MAX_BENCHMARK_WARMUP;

export function parsePositiveBenchmarkInteger(input: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = Number(input);
  if (!/^[1-9]\d*$/u.test(input) || !Number.isSafeInteger(value)) {
    throw flowInputInvalid(`Expected "${input}" to be a positive safe integer.`);
  }
  if (value > maximum) {
    throw flowInputInvalid(`Expected "${input}" to be no greater than ${maximum}.`);
  }
  return value;
}

export function parseNonnegativeBenchmarkInteger(input: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const value = Number(input);
  if (!/^(?:0|[1-9]\d*)$/u.test(input) || !Number.isSafeInteger(value)) {
    throw flowInputInvalid(`Expected "${input}" to be a non-negative safe integer.`);
  }
  if (value > maximum) {
    throw flowInputInvalid(`Expected "${input}" to be no greater than ${maximum}.`);
  }
  return value;
}

export function assertBenchmarkWorkload(workload: {
  iterations: number;
  warmup: number;
  concurrency: number;
  inputCount: number;
}): void {
  const limits = [
    ['iterations', workload.iterations, 1, MAX_BENCHMARK_ITERATIONS],
    ['warm-up samples', workload.warmup, 0, MAX_BENCHMARK_WARMUP],
    ['concurrency', workload.concurrency, 1, MAX_BENCHMARK_CONCURRENCY],
    ['input objects', workload.inputCount, 1, MAX_BENCHMARK_INPUTS],
  ] as const;
  for (const [label, value, minimum, maximum] of limits) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw flowInputInvalid(`Flow benchmark ${label} must be between ${minimum} and ${maximum}.`);
    }
  }
  if (workload.iterations + workload.warmup > MAX_BENCHMARK_SAMPLES) {
    throw flowInputInvalid(`Flow benchmark cannot exceed ${MAX_BENCHMARK_SAMPLES} total samples.`);
  }
}

export function parseBenchmarkPercentile(input: string): number {
  const value = Number(input);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(input) || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw flowInputInvalid(`Percentile "${input}" must be greater than 0 and no greater than 100.`);
  }
  return value;
}
