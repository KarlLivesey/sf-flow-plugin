/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { parseApexCpuTime } from '../../src/utils/flow-benchmark-log.js';
import {
  assertBenchmarkSampleTimeout,
  assertBenchmarkWorkload,
  parseBenchmarkWaitMinutes,
  parseNonnegativeBenchmarkInteger,
  parsePositiveBenchmarkInteger,
} from '../../src/utils/flow-benchmark-flags.js';
import { calculateBenchmarkStatistics } from '../../src/utils/flow-benchmark-statistics.js';
import { completedBenchmarkSample } from '../../src/utils/flow-benchmark-sample.js';

describe('Flow benchmark log analysis', (): void => {
  it('uses the final maximum CPU line from a Salesforce debug log', (): void => {
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
    expect(parsePositiveBenchmarkInteger('1000000')).to.equal(1_000_000);
    expect(() => parsePositiveBenchmarkInteger('9007199254740992')).to.throw('positive safe integer');
    expect(() => parseNonnegativeBenchmarkInteger('-1')).to.throw('non-negative safe integer');
  });
});

describe('Flow benchmark workload limits', (): void => {
  it('does not impose workload, concurrency or input-count caps', (): void => {
    expect(() => {
      assertBenchmarkWorkload({
        iterations: 1_000_000,
        warmup: 100_000,
        concurrency: 1000,
        inputCount: 100_000,
      });
    }).not.to.throw();
  });
});

describe('Flow benchmark timeout flags', (): void => {
  it('accepts positive whole-minute SOAP timeouts without an arbitrary ceiling', (): void => {
    expect(parseBenchmarkWaitMinutes('1')).to.equal(1);
    expect(parseBenchmarkWaitMinutes('11')).to.equal(11);
    expect(() => {
      assertBenchmarkSampleTimeout(660_000);
    }).not.to.throw();
    for (const invalid of ['0', '1.5', '9007199254740991']) {
      expect(() => parseBenchmarkWaitMinutes(invalid)).to.throw();
    }
  });

  it('rejects a combined sample count that cannot be represented safely', (): void => {
    expect(() => {
      assertBenchmarkWorkload({
        iterations: Number.MAX_SAFE_INTEGER,
        warmup: 1,
        concurrency: 1,
        inputCount: 1,
      });
    }).to.throw('safe combined count');
  });
});

describe('Flow benchmark SOAP failure samples', (): void => {
  it('retains compile logs and publishes only a bounded, normalised diagnostic', (): void => {
    const completed = completedBenchmarkSample(
      { sample: 1, phase: 'measured', inputIndex: 0, input: {} },
      {
        wallClockMilliseconds: 12,
        transport: {
          correlationId: 'correlation',
          execution: {
            compiled: false,
            success: false,
            line: 2,
            column: 3,
            compileProblem: `Unexpected\n${'x'.repeat(600)}`,
            exceptionMessage: null,
            exceptionStackTrace: null,
          },
          rawLog: 'compile failure log',
          log: {
            id: null,
            status: 'Failed',
            operation: 'executeAnonymous',
            startTime: '2026-07-29T12:00:00.000Z',
            durationMilliseconds: 12,
            logLength: 19,
          },
        },
      }
    );

    expect(completed.sample).to.deep.include({
      successful: false,
      errorCode: 'APEX_COMPILE_ERROR',
      wallClockMilliseconds: 12,
    });
    expect(completed.sample.errorMessage).to.match(/^Generated Apex could not be compiled: Unexpected x+…$/u);
    expect(completed.sample.errorMessage).not.to.include('\n');
    expect(completed.rawLog).to.equal('compile failure log');
  });
});

describe('Flow benchmark empty compile diagnostics', (): void => {
  it('treats a whitespace-only compile diagnostic as absent', (): void => {
    const completed = completedBenchmarkSample(
      { sample: 1, phase: 'measured', inputIndex: 0, input: {} },
      {
        wallClockMilliseconds: 12,
        transport: {
          correlationId: 'correlation',
          execution: {
            compiled: false,
            success: false,
            line: 2,
            column: 3,
            compileProblem: ' \n\t ',
            exceptionMessage: null,
            exceptionStackTrace: null,
          },
          rawLog: '',
          log: {
            id: null,
            status: 'Failed',
            operation: 'executeAnonymous',
            startTime: '2026-07-29T12:00:00.000Z',
            durationMilliseconds: 12,
            logLength: 0,
          },
        },
      }
    );
    expect(completed.sample.errorMessage).to.equal('Generated Apex could not be compiled.');
  });
});

describe('Flow benchmark runtime failure samples', (): void => {
  it('does not expose runtime exception values in the public sample', (): void => {
    const completed = completedBenchmarkSample(
      { sample: 1, phase: 'measured', inputIndex: 0, input: {} },
      {
        wallClockMilliseconds: 8,
        transport: {
          correlationId: 'correlation',
          execution: {
            compiled: true,
            success: false,
            line: -1,
            column: -1,
            compileProblem: null,
            exceptionMessage: 'Secret customer value',
            exceptionStackTrace: 'Secret stack',
          },
          rawLog: '',
          log: {
            id: null,
            status: 'Failed',
            operation: 'executeAnonymous',
            startTime: '2026-07-29T12:00:00.000Z',
            durationMilliseconds: 8,
            logLength: 0,
          },
        },
      }
    );

    expect(completed.sample.errorMessage).not.to.include('Secret customer value');
    expect(completed.sample.errorMessage).not.to.include('Secret stack');
  });
});
