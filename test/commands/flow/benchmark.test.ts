/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowBenchmark, { type BenchmarkFlagValues } from '../../../src/commands/flow/benchmark.js';
import { FlowBenchmarkService } from '../../../src/services/flow-benchmark-service.js';
import type { FlowBenchmarkResult } from '../../../src/types/flow-benchmark.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';
import { createCommandOrg } from '../../helpers/command-org.js';

const result: FlowBenchmarkResult = {
  apiName: 'Calculate_Discount',
  namespace: null,
  definitionId: '300000000000001',
  version: 1,
  targetOrg: 'admin@example.com',
  production: false,
  dryRun: false,
  successful: true,
  iterations: 4,
  warmup: 1,
  requestedConcurrency: 2,
  effectiveConcurrency: 2,
  completedSamples: 5,
  failedSamples: 0,
  includedSamples: 4,
  totalWallClockMilliseconds: 100,
  throughputPerSecond: 40,
  wallClock: null,
  cpuTime: null,
  samples: [],
};

function flags(): BenchmarkFlagValues {
  return {
    'api-name': 'Calculate_Discount',
    'target-org': createCommandOrg({} as Connection),
    input: ['percentage=10'],
    'input-file': undefined,
    iterations: 4,
    warmup: 1,
    concurrency: 2,
    percentile: [99, 50, 50],
    'continue-on-error': true,
    'include-failed': true,
    'raw-log-dir': undefined,
    'exclude-warmup-logs': false,
    'output-file': undefined,
    'dry-run': false,
    confirm: false,
    'log-level': 'detailed',
    wait: 2,
    'if-active-version': 7,
    namespace: undefined,
    'api-version': undefined,
  };
}

describe('flow benchmark command', (): void => {
  it('defines deliberate benchmark defaults and tracing options', (): void => {
    expect(FlowBenchmark.flags.iterations.default).to.equal(100);
    expect(FlowBenchmark.flags.warmup.default).to.equal(10);
    expect(FlowBenchmark.flags.concurrency.default).to.equal(1);
    expect(FlowBenchmark.flags.percentile.default).to.deep.equal([50, 90, 95, 99]);
    expect(FlowBenchmark.flags['log-level'].options).to.deep.equal(['detailed', 'finest']);
  });

  it('normalises percentiles and passes the complete contract to the service', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowBenchmark.prototype, 'parseFlags').resolves(flags());
    const benchmark = $$.SANDBOX.stub(FlowBenchmarkService.prototype, 'benchmark').resolves({
      result,
      rawLogs: [],
    });

    const actual = await FlowBenchmark.run(['--json']);

    expect(benchmark.firstCall.args[0]).to.deep.equal({
      apiName: 'Calculate_Discount',
      targetOrg: 'admin@example.com',
      inputs: [{ percentage: '10' }],
      iterations: 4,
      warmup: 1,
      concurrency: 2,
      percentiles: [50, 99],
      continueOnError: true,
      includeFailed: true,
      dryRun: false,
      confirm: false,
      logLevel: 'detailed',
      waitMilliseconds: 120_000,
      expectedActiveVersion: 7,
    });
    expect(actual).to.equal(result);
  });
});
