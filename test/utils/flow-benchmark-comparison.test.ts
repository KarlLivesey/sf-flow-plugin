/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { FlowBenchmarkService } from '../../src/services/flow-benchmark-service.js';
import {
  assertBenchmarkComparable,
  compareBenchmark,
  readBenchmarkBaseline,
} from '../../src/utils/flow-benchmark-comparison.js';
import { flowBenchmarkGateways, flowBenchmarkRequest } from '../helpers/flow-benchmark-fixtures.js';

async function savedBaseline(directory: string): Promise<{
  request: ReturnType<typeof flowBenchmarkRequest>;
  result: Awaited<ReturnType<FlowBenchmarkService['benchmark']>>['result'];
  baseline: NonNullable<Awaited<ReturnType<typeof readBenchmarkBaseline>>>;
}> {
  const request = flowBenchmarkRequest();
  const { result } = await new FlowBenchmarkService(flowBenchmarkGateways()).benchmark(request);
  const file = join(directory, 'baseline.json');
  await writeFile(file, JSON.stringify({ status: 0, result, warnings: [] }));
  const baseline = await readBenchmarkBaseline(file);
  if (baseline === undefined) {
    throw new Error('Expected parsed baseline.');
  }
  return { request, result, baseline };
}

async function verifyRegression(directory: string): Promise<void> {
  const { request, result, baseline } = await savedBaseline(directory);
  expect(() => {
    assertBenchmarkComparable(baseline, request);
  }).not.to.throw();
  const comparison = compareBenchmark(
    {
      ...result,
      cpuTime: { count: 4, minimum: 1, maximum: 100, mean: 50, percentiles: [{ percentile: 95, value: 100 }] },
    },
    baseline,
    { metric: 'cpu', percentile: 95, maximum: 10 }
  );
  expect(comparison).to.include({ baselineValue: 50, currentValue: 100, regressionPercent: 100, exceeded: true });
  expect(() => {
    assertBenchmarkComparable(baseline, { ...request, inputs: [{}] });
  }).to.throw('inputFingerprint');
  expect(() => {
    assertBenchmarkComparable(baseline, { ...request, concurrency: 5 });
  }).to.throw('requestedConcurrency');
  expect(() =>
    compareBenchmark({ ...result, namespace: 'other' }, baseline, { metric: 'cpu', percentile: 95, maximum: 10 })
  ).to.throw('different qualified Flow');
}

async function verifyDryComparison(directory: string): Promise<void> {
  const { result } = await new FlowBenchmarkService(flowBenchmarkGateways()).benchmark(flowBenchmarkRequest());
  const file = join(directory, 'baseline.json');
  await writeFile(file, JSON.stringify(result));
  const baseline = await readBenchmarkBaseline(file);
  if (baseline === undefined) {
    throw new Error('Expected parsed baseline.');
  }
  const comparison = compareBenchmark({ ...result, dryRun: true }, baseline, {
    metric: 'wall-clock',
    percentile: 95,
    maximum: 0,
  });
  expect(comparison).to.include({ currentValue: null, exceeded: null, regressionPercent: null });
}

async function verifyInvalidBaseline(directory: string): Promise<void> {
  const file = join(directory, 'baseline.json');
  await writeFile(file, JSON.stringify({ apiName: 'Calculate_Discount', successful: false }));
  const error: unknown = await readBenchmarkBaseline(file).catch((caught: unknown) => caught);
  expect(error).to.have.property('name', 'FlowBenchmarkFailed');
}

describe('benchmark regression comparison', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow regression '));
  });
  afterEach(async (): Promise<void> => rm(directory, { recursive: true, force: true }));

  it('compares matching runs and reports user-selected percentile regressions', async (): Promise<void> =>
    verifyRegression(directory));

  it('reports dry-run comparison outcomes as unknown', async (): Promise<void> => verifyDryComparison(directory));

  it('rejects failed or legacy baselines rather than claiming comparability', async (): Promise<void> =>
    verifyInvalidBaseline(directory));
});
