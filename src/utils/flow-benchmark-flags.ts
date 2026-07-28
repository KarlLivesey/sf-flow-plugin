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

export function parseBenchmarkPercentile(input: string): number {
  const value = Number(input);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(input) || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw flowInputInvalid(`Percentile "${input}" must be greater than 0 and no greater than 100.`);
  }
  return value;
}
