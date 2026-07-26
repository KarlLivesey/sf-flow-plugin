/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowActiveVersionMismatch } from '../errors/flow-errors.js';
import type { FlowVersionNumber } from '../types/flow.js';

export function assertExpectedActiveVersion(
  apiName: string,
  expected: FlowVersionNumber | undefined,
  actual: FlowVersionNumber | null
): void {
  if (expected !== undefined && expected !== actual) {
    throw flowActiveVersionMismatch(apiName, expected, actual);
  }
}
