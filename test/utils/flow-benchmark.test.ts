/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { parseApexCpuTime } from '../../src/utils/flow-benchmark-log.js';
import {
  assertBenchmarkWorkload,
  MAX_BENCHMARK_CONCURRENCY,
  MAX_BENCHMARK_ITERATIONS,
  parseNonnegativeBenchmarkInteger,
  parsePositiveBenchmarkInteger,
} from '../../src/utils/flow-benchmark-flags.js';
import { calculateBenchmarkStatistics } from '../../src/utils/flow-benchmark-statistics.js';

describe('Flow benchmark log analysis', (): void => {
  it('uses the final maximum CPU line from a Salesforce ApexLog', (): void => {
    expect(
      parseApexCpuTime('Maximum CPU time: 12 out of 10000\nother detail\nMaximum CPU time: 37 out of 10000')
    ).to.equal(37);
  });

  it('returns null when Salesforce did not emit CPU usage', (): void => {
    expect(parseApexCpuTime('FLOW_START_INTERVIEW_BEGIN')).to.equal(null);
  });
});

describe('Flow benchmark statistics', (): void => {
  it('calculates nearest-rank percentiles without interpolating samples', (): void => {
    expect(calculateBenchmarkStatistics([4, 1, 3, 2], [50, 90, 100])).to.deep.equal({
      count: 4,
      minimum: 1,
      maximum: 4,
      mean: 2.5,
      percentiles: [
        { percentile: 50, value: 2 },
        { percentile: 90, value: 4 },
        { percentile: 100, value: 4 },
      ],
    });
  });
});

describe('Flow benchmark integer flags', (): void => {
  it('accepts only safe whole-number iteration and warm-up counts', (): void => {
    expect(parsePositiveBenchmarkInteger('1')).to.equal(1);
    expect(parseNonnegativeBenchmarkInteger('0')).to.equal(0);
    expect(() => parsePositiveBenchmarkInteger('9007199254740992')).to.throw('positive safe integer');
    expect(() => parseNonnegativeBenchmarkInteger('-1')).to.throw('non-negative safe integer');
    expect(() => parsePositiveBenchmarkInteger('10001', MAX_BENCHMARK_ITERATIONS)).to.throw('no greater than 10000');
  });

  it('rejects excessive workloads before execution', (): void => {
    expect(() => {
      assertBenchmarkWorkload({ iterations: 1, warmup: 0, concurrency: MAX_BENCHMARK_CONCURRENCY + 1, inputCount: 1 });
    }).to.throw('concurrency must be between 1 and 100');
  });
});
