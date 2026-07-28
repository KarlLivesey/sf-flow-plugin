/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowBenchmarkService } from '../../services/flow-benchmark-service.js';
import { ToolingFlowBenchmarkGateway } from '../../services/tooling-flow-benchmark-gateway.js';
import { ToolingFlowDebugGateway } from '../../services/tooling-flow-debug-gateway.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowBenchmarkRequest, FlowBenchmarkResult } from '../../types/flow-benchmark.js';
import type { FlowDebugLogLevel } from '../../types/flow-debug.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import {
  persistFlowBenchmark,
  prepareFlowBenchmarkDestinations,
  type FlowBenchmarkDestinations,
} from '../../utils/flow-benchmark-files.js';
import {
  parseBenchmarkPercentile,
  parseNonnegativeBenchmarkInteger,
  parsePositiveBenchmarkInteger,
} from '../../utils/flow-benchmark-flags.js';
import { readFlowInputs } from '../../utils/flow-input-file.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.benchmark');

export interface BenchmarkFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  input: string[];
  'input-file': string | undefined;
  iterations: number;
  warmup: number;
  concurrency: number;
  percentile: number[];
  'continue-on-error': boolean;
  'include-failed': boolean;
  'raw-log-dir': string | undefined;
  'exclude-warmup-logs': boolean;
  'output-file': string | undefined;
  'dry-run': boolean;
  confirm: boolean;
  'log-level': FlowDebugLogLevel;
  wait: number;
  'if-active-version': number | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

async function createRequest(
  flags: BenchmarkFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): Promise<FlowBenchmarkRequest> {
  return {
    ...createNamedFlowRequest(flags, context),
    inputs: await readFlowInputs(flags['input-file'], flags.input),
    iterations: flags.iterations,
    warmup: flags.warmup,
    concurrency: flags.concurrency,
    percentiles: [...new Set(flags.percentile)].sort((left, right) => left - right),
    continueOnError: flags['continue-on-error'],
    includeFailed: flags['include-failed'],
    dryRun: flags['dry-run'],
    confirm: flags.confirm,
    logLevel: flags['log-level'],
    waitMilliseconds: flags.wait * 60_000,
    ...(flags['if-active-version'] === undefined ? {} : { expectedActiveVersion: flags['if-active-version'] }),
  };
}

export default class FlowBenchmark extends SfCommand<FlowBenchmarkResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'api-name': Flags.string({
      char: 'n',
      required: true,
      summary: messages.getMessage('flags.api-name.summary'),
    }),
    'target-org': Flags.requiredOrg({
      char: 'o',
      required: false,
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    input: Flags.string({
      default: [],
      multiple: true,
      exclusive: ['input-file'],
      summary: messages.getMessage('flags.input.summary'),
    }),
    'input-file': Flags.file({
      exists: true,
      exclusive: ['input'],
      summary: messages.getMessage('flags.input-file.summary'),
    }),
    iterations: Flags.custom<number>({
      default: 100,
      parse: (input: string): Promise<number> => Promise.resolve(parsePositiveBenchmarkInteger(input)),
      summary: messages.getMessage('flags.iterations.summary'),
    })(),
    warmup: Flags.custom<number>({
      default: 10,
      parse: (input: string): Promise<number> => Promise.resolve(parseNonnegativeBenchmarkInteger(input)),
      summary: messages.getMessage('flags.warmup.summary'),
    })(),
    concurrency: Flags.custom<number>({
      default: 1,
      parse: (input: string): Promise<number> => Promise.resolve(parsePositiveBenchmarkInteger(input)),
      summary: messages.getMessage('flags.concurrency.summary'),
    })(),
    percentile: Flags.custom<number>({
      default: [50, 90, 95, 99],
      multiple: true,
      parse: (input: string): Promise<number> => Promise.resolve(parseBenchmarkPercentile(input)),
      summary: messages.getMessage('flags.percentile.summary'),
    })(),
    'continue-on-error': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.continue-on-error.summary'),
    }),
    'include-failed': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.include-failed.summary'),
    }),
    'raw-log-dir': Flags.directory({
      exists: false,
      summary: messages.getMessage('flags.raw-log-dir.summary'),
    }),
    'exclude-warmup-logs': Flags.boolean({
      default: false,
      relationships: [{ type: 'some', flags: ['raw-log-dir'] }],
      summary: messages.getMessage('flags.exclude-warmup-logs.summary'),
    }),
    'output-file': Flags.file({
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    'dry-run': Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.dry-run.summary'),
    }),
    confirm: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.confirm.summary'),
    }),
    'log-level': Flags.custom<FlowDebugLogLevel>({
      default: 'detailed',
      options: ['detailed', 'finest'],
      summary: messages.getMessage('flags.log-level.summary'),
    })(),
    wait: Flags.integer({
      default: 2,
      min: 1,
      max: 10,
      summary: messages.getMessage('flags.wait.summary'),
    }),
    'if-active-version': Flags.custom<number>({
      parse: (input: string): Promise<number> => Promise.resolve(parsePositiveBenchmarkInteger(input)),
      summary: messages.getMessage('flags.if-active-version.summary'),
    })(),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowBenchmarkResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const destinations = await prepareFlowBenchmarkDestinations(
      flags['output-file'],
      flags['raw-log-dir'],
      flags['exclude-warmup-logs']
    );
    const result = await this.execute(flags, context, destinations);
    if (result.successful === false) {
      process.exitCode = 1;
    }
    return result;
  }

  public async parseFlags(): Promise<BenchmarkFlagValues> {
    const { flags } = await this.parse(FlowBenchmark);
    return flags;
  }

  private async execute(
    flags: BenchmarkFlagValues,
    context: ReturnType<typeof createFlowCommandContext>,
    destinations: FlowBenchmarkDestinations
  ): Promise<FlowBenchmarkResult> {
    const request = await createRequest(flags, context);
    const definition = new ToolingFlowDefinitionGateway(context.connection);
    const artifact = await withFlowProgress(this.spinner, 'benchmark', async (progress) =>
      new FlowBenchmarkService({
        definition,
        debug: new ToolingFlowDebugGateway(context.connection),
        benchmark: new ToolingFlowBenchmarkGateway(context.connection),
      }).benchmark(request, progress)
    );
    await persistFlowBenchmark(destinations, artifact);
    this.writeHumanOutput(artifact.result);
    return artifact.result;
  }

  private writeHumanOutput(result: FlowBenchmarkResult): void {
    this.table({
      title: messages.getMessage('info.summary-title', [
        qualifiedFlowName(result.apiName, result.namespace),
        result.version,
      ]),
      data: [
        {
          iterations: `${result.completedSamples}/${result.iterations + result.warmup}`,
          concurrency: `${result.effectiveConcurrency} effective (${result.requestedConcurrency} requested)`,
          failures: result.failedSamples,
          totalWallClock: result.totalWallClockMilliseconds,
          throughput: result.throughputPerSecond ?? '-',
        },
      ],
      columns: [
        { key: 'iterations', name: 'Completed samples' },
        { key: 'concurrency', name: 'Concurrency' },
        { key: 'failures', name: 'Failures' },
        { key: 'totalWallClock', name: 'Total wall-clock (ms)' },
        { key: 'throughput', name: 'Measured samples/s' },
      ],
    });
    this.writeStatistics(result);
    this.writeSamples(result);
  }

  private writeSamples(result: FlowBenchmarkResult): void {
    this.table({
      title: messages.getMessage('info.samples-title'),
      data: result.samples.map((sample) => ({ ...sample })),
      columns: [
        { key: 'phase', name: 'Phase' },
        { key: 'sample', name: 'Sample' },
        { key: 'inputIndex', name: 'Input index' },
        { key: 'successful', name: 'Successful' },
        { key: 'rollbackConfirmed', name: 'Rollback' },
        { key: 'wallClockMilliseconds', name: 'Wall-clock (ms)' },
        { key: 'cpuTimeMilliseconds', name: 'CPU (ms)' },
        { key: 'apexLogId', name: 'ApexLog ID' },
        { key: 'errorCode', name: 'Error' },
      ],
    });
  }

  private writeStatistics(result: FlowBenchmarkResult): void {
    const rows = [
      { metric: 'Wall-clock', statistics: result.wallClock },
      { metric: 'CPU', statistics: result.cpuTime },
    ].flatMap(({ metric, statistics }) =>
      statistics === null
        ? []
        : [
            {
              metric,
              count: statistics.count,
              minimum: statistics.minimum,
              maximum: statistics.maximum,
              mean: statistics.mean,
              percentiles: statistics.percentiles.map((entry) => `p${entry.percentile}=${entry.value}`).join(', '),
            },
          ]
    );
    this.table({
      title: messages.getMessage('info.statistics-title'),
      data: rows,
      columns: [
        { key: 'metric', name: 'Metric (ms)' },
        { key: 'count', name: 'Count' },
        { key: 'minimum', name: 'Min' },
        { key: 'maximum', name: 'Max' },
        { key: 'mean', name: 'Mean' },
        { key: 'percentiles', name: 'Percentiles' },
      ],
    });
  }
}
