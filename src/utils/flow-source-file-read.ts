/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowSourceInvalid } from '../errors/flow-errors.js';
import type { FlowSourceSnapshot } from '../types/flow-source.js';

export function completeSourceRead(context: {
  sourceFile: string;
  result: { content: string; snapshot: FlowSourceSnapshot } | undefined;
  primaryFailure: Error | undefined;
  closeFailure: unknown;
}): { content: string; snapshot: FlowSourceSnapshot } {
  if (context.primaryFailure !== undefined && context.closeFailure !== undefined) {
    throw flowSourceInvalid(
      context.primaryFailure.message,
      new AggregateError(
        [context.primaryFailure, context.closeFailure],
        'Reading and closing the Flow source file both failed.'
      )
    );
  }
  if (context.primaryFailure !== undefined) {
    throw context.primaryFailure;
  }
  if (context.closeFailure !== undefined) {
    throw flowSourceInvalid(
      `Flow source file "${context.sourceFile}" could not be closed after reading.`,
      context.closeFailure
    );
  }
  if (context.result === undefined) {
    throw flowSourceInvalid(`Flow source file "${context.sourceFile}" could not be read.`);
  }
  return context.result;
}
