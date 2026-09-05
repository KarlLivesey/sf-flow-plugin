/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Flags } from '@salesforce/sf-plugins-core';

import { parseRegressionPercent } from './flow-benchmark-comparison.js';
import { parseBenchmarkPercentile } from './flow-benchmark-flags.js';

export const benchmarkReportFlags = {
  baseline: Flags.file({
    exists: true,
    summary: 'Compare against a successful benchmark JSON result with matching inputs and settings.',
  }),
  'max-regression': Flags.custom<number>({
    dependsOn: ['baseline'],
    summary: 'Fail when the selected percentile increases by more than this percentage.',
    parse: (value: string): Promise<number> => Promise.resolve(parseRegressionPercent(value)),
  })(),
  'regression-metric': Flags.custom<'cpu' | 'wall-clock'>({
    dependsOn: ['baseline'],
    options: ['cpu', 'wall-clock'],
    summary: 'Metric to compare (default: cpu).',
  })(),
  'regression-percentile': Flags.custom<number>({
    dependsOn: ['baseline'],
    summary: 'Percentile to compare (default: 95).',
    parse: (value: string): Promise<number> => Promise.resolve(parseBenchmarkPercentile(value)),
  })(),
  'samples-file': Flags.string({
    summary: 'Stream samples to a new JSONL file instead of retaining sample records in memory.',
  }),
};
