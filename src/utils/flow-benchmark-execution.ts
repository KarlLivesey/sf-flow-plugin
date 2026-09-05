/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { ApexSoapFlowBenchmarkGateway } from '../services/apex-soap-flow-benchmark-gateway.js';
import { ApexSoapFlowDebugGateway } from '../services/apex-soap-flow-debug-gateway.js';
import { FlowBenchmarkService } from '../services/flow-benchmark-service.js';
import { ToolingFlowDefinitionGateway } from '../services/tooling-flow-definition-gateway.js';
import type { FlowBenchmarkArtifact, FlowBenchmarkRequest } from '../types/flow-benchmark.js';
import { createFlowBenchmarkRequest, type BenchmarkFlagValues } from './flow-benchmark-command.js';
import type { createFlowCommandContext } from './flow-command.js';
import type { FlowBenchmarkDestinations } from './flow-benchmark-files.js';
import { assertBenchmarkComparable, readBenchmarkBaseline, compareBenchmark } from './flow-benchmark-comparison.js';
import { prepareBenchmarkStream, withBenchmarkStream } from './flow-benchmark-stream.js';
import type { FlowProgressReporter } from './flow-progress.js';

interface ExecutionContext {
  interruptListeners: NodeJS.SignalsListener[];
  flags: BenchmarkFlagValues;
  context: ReturnType<typeof createFlowCommandContext>;
  destinations: FlowBenchmarkDestinations;
}

/** Validate all comparison settings and destinations before scheduling any invocation. */
export async function executeFlowBenchmark(
  execution: ExecutionContext,
  progress: FlowProgressReporter,
  warn: (request: FlowBenchmarkRequest) => void
): Promise<FlowBenchmarkArtifact> {
  const { flags, context, destinations } = execution;
  const request = await createFlowBenchmarkRequest(flags, context, destinations);
  const streamFile = await prepareBenchmarkStream(flags['samples-file'], destinations);
  const baseline = await readBenchmarkBaseline(flags.baseline);
  assertBenchmarkComparable(baseline, request);
  const selection = {
    metric: flags['regression-metric'] ?? 'cpu',
    percentile: flags['regression-percentile'] ?? 95,
    maximum: flags['max-regression'],
  };
  request.percentiles =
    baseline === undefined
      ? request.percentiles
      : [...new Set([...request.percentiles, selection.percentile])].sort((left, right) => left - right);
  warn(request);
  return withBenchmarkStream(
    { file: streamFile, dryRun: request.dryRun, interruptListeners: execution.interruptListeners },
    async (control) => {
      const artifact = await new FlowBenchmarkService({
        definition: new ToolingFlowDefinitionGateway(context.connection),
        debug: new ApexSoapFlowDebugGateway(context.connection),
        benchmark: new ApexSoapFlowBenchmarkGateway(context.connection),
      }).benchmark(request, progress, {
        ...control,
        onPrepared: (prepared) => {
          if (baseline !== undefined) {
            compareBenchmark(prepared, baseline, selection);
          }
        },
      });
      if (baseline !== undefined) {
        artifact.result.comparison = compareBenchmark(artifact.result, baseline, selection);
      }
      return artifact;
    }
  );
}
