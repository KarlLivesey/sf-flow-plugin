/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
interface FlowBenchmarkExecutionErrorOptions {
  errorCode: string;
  executionDurationMilliseconds: number | null;
  safeMessage?: string;
  rawLog?: string | null;
}

export class FlowBenchmarkExecutionError extends Error {
  public readonly errorCode: string;
  public readonly executionDurationMilliseconds: number | null;
  public readonly safeMessage: string;
  public readonly rawLog: string | null;

  public constructor(options: FlowBenchmarkExecutionErrorOptions) {
    const safeMessage = options.safeMessage ?? 'The Apex SOAP benchmark request failed.';
    super(safeMessage);
    this.name = 'FlowBenchmarkExecutionError';
    this.errorCode = options.errorCode;
    this.executionDurationMilliseconds = options.executionDurationMilliseconds;
    this.safeMessage = safeMessage;
    this.rawLog = options.rawLog ?? null;
  }
}
