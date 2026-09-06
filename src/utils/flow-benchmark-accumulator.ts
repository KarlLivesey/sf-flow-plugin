/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowBenchmarkRequest, FlowBenchmarkSample } from '../types/flow-benchmark.js';

/** Retain only numeric measurements for exact percentiles when sample records are streamed. */
export class FlowBenchmarkAccumulator {
  public completed = 0;
  public measured = 0;
  public failed = 0;
  public included = 0;
  public readonly cpu: number[] = [];
  public readonly wallClock: number[] = [];

  public constructor(private readonly includeFailed: FlowBenchmarkRequest['includeFailed']) {}

  public add(sample: FlowBenchmarkSample): void {
    this.completed += 1;
    this.failed += Number(!sample.successful);
    this.measured += Number(sample.phase === 'measured');
    if (sample.phase === 'measured' && (sample.successful || this.includeFailed)) {
      this.include(sample);
    }
  }

  private include(sample: FlowBenchmarkSample): void {
    this.included += 1;
    if (sample.cpuTimeMilliseconds !== null) {
      this.cpu.push(sample.cpuTimeMilliseconds);
    }
    if (sample.wallClockMilliseconds !== null) {
      this.wallClock.push(sample.wallClockMilliseconds);
    }
  }
}
