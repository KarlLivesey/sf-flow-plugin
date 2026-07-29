/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInputInvalid } from '../errors/flow-errors.js';

export function parsePositiveBenchmarkInteger(input: string): number {
  const value = Number(input);
  if (!/^[1-9]\d*$/u.test(input) || !Number.isSafeInteger(value)) {
    throw flowInputInvalid(`Expected "${input}" to be a positive safe integer.`);
  }
  return value;
}

export function parseNonnegativeBenchmarkInteger(input: string): number {
  const value = Number(input);
  if (!/^(?:0|[1-9]\d*)$/u.test(input) || !Number.isSafeInteger(value)) {
    throw flowInputInvalid(`Expected "${input}" to be a non-negative safe integer.`);
  }
  return value;
}

export function parseBenchmarkWaitMinutes(input: string): number {
  const value = parsePositiveBenchmarkInteger(input);
  if (!Number.isSafeInteger(value * 60_000)) {
    throw flowInputInvalid(`Expected "${input}" minutes to have a safely representable millisecond value.`);
  }
  return value;
}

export function assertBenchmarkSampleTimeout(sampleTimeoutMilliseconds: number): void {
  if (
    !Number.isSafeInteger(sampleTimeoutMilliseconds) ||
    sampleTimeoutMilliseconds < 60_000 ||
    sampleTimeoutMilliseconds % 60_000 !== 0
  ) {
    throw flowInputInvalid(
      'Flow benchmark sample timeout must be a positive, safely representable whole-minute value.'
    );
  }
}

export function assertBenchmarkWorkload(workload: {
  iterations: number;
  warmup: number;
  concurrency: number;
  inputCount: number;
}): void {
  const requirements = [
    ['iterations', workload.iterations, 1],
    ['warm-up samples', workload.warmup, 0],
    ['concurrency', workload.concurrency, 1],
    ['input objects', workload.inputCount, 1],
  ] as const;
  for (const [label, value, minimum] of requirements) {
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw flowInputInvalid(`Flow benchmark ${label} must be a safe integer no less than ${minimum}.`);
    }
  }
  if (!Number.isSafeInteger(workload.iterations + workload.warmup)) {
    throw flowInputInvalid('Flow benchmark measured and warm-up samples must have a safe combined count.');
  }
}

export function parseBenchmarkPercentile(input: string): number {
  const value = Number(input);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(input) || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw flowInputInvalid(`Percentile "${input}" must be greater than 0 and no greater than 100.`);
  }
  return value;
}
