/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { flowInspectionFailed } from '../../errors/flow-errors.js';

import { FlowGraphService } from '../../services/flow-graph-service.js';
import { graphLocalDirectory } from '../../services/flow-local-graph-service.js';
import { highlightFlowGraph } from '../../services/flow-graph-change-service.js';
import { graphFlowSource } from '../../services/flow-source-analysis-service.js';
import { loadFlowSource } from '../../services/flow-source-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowGraphCurve,
  FlowGraphDirection,
  FlowGraphElkCycleBreaking,
  FlowGraphElkModelOrder,
  FlowGraphElkNodePlacement,
  FlowGraphFormat,
  FlowGraphLayout,
  FlowGraphRequest,
  FlowGraphResult,
  FlowSubflowVersionSelector,
  FlowTraversalWarningKind,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import {
  createSourceGraphRequest,
  parseGraphColorOverrides,
  validateGraphFormatOptions,
  writeGraphOutput,
} from '../../utils/flow-graph-command.js';
import { flowGraphFlags } from '../../utils/flow-graph-flags.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { validateFlowSourceFlags } from '../../utils/flow-source-command.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.graph');

const warningMessages: Record<FlowTraversalWarningKind, (path: string) => string> = {
  'depth-limit': (path) => messages.getMessage('warnings.depth-limit', [path]),
  'missing-subflow': (path) => messages.getMessage('warnings.missing-subflow', [path]),
  'missing-subflow-version': (path) => messages.getMessage('warnings.missing-subflow-version', [path]),
  'subflow-version-fallback': (path) => messages.getMessage('warnings.subflow-version-fallback', [path]),
};

export interface GraphFlagValues {
  'highlight-changes'?: boolean;
  from?: FlowComparisonVersionSelector | undefined;
  'from-file'?: string | undefined;
  'source-dir'?: string | undefined;
  'api-name': string | undefined;
  'source-file': string | undefined;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  'subflow-version': FlowSubflowVersionSelector;
  format: FlowGraphFormat;
  recursive: boolean;
  'max-depth': number;
  'include-variables': boolean;
  'include-formulas': boolean;
  direction: FlowGraphDirection;
  layout: FlowGraphLayout[];
  curve: FlowGraphCurve;
  'node-placement': FlowGraphElkNodePlacement;
  'model-order': FlowGraphElkModelOrder;
  'cycle-breaking': FlowGraphElkCycleBreaking;
  'merge-edges': boolean;
  'force-node-order': boolean;
  'node-spacing': number;
  'rank-spacing': number;
  legend: boolean;
  'label-width': number;
  color: string[] | undefined;
  'font-family': string;
  'font-size': number;
  'output-file': string | undefined;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(flags: GraphFlagValues, context: ReturnType<typeof createFlowCommandContext>): FlowGraphRequest {
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow graphing.');
  }
  return {
    ...createNamedFlowRequest({ ...flags, 'api-name': flags['api-name'] }, context),
    version: flags['flow-version'],
    subflowVersion: flags['subflow-version'],
    format: flags.format,
    recursive: flags.recursive,
    maxDepth: flags['max-depth'],
    includeVariables: flags['include-variables'],
    includeFormulas: flags['include-formulas'],
    direction: flags.direction,
    layout: flags.layout,
    curve: flags.curve,
    elk: {
      nodePlacement: flags['node-placement'],
      modelOrder: flags['model-order'],
      cycleBreaking: flags['cycle-breaking'],
      mergeEdges: flags['merge-edges'],
      forceNodeOrder: flags['force-node-order'],
    },
    nodeSpacing: flags['node-spacing'],
    rankSpacing: flags['rank-spacing'],
    legend: flags.legend,
    labelWidth: flags['label-width'],
    style: {
      colors: parseGraphColorOverrides(flags.color ?? []),
      fontFamily: flags['font-family'],
      fontSize: flags['font-size'],
    },
  };
}

function validateGraphComparisonInput(flags: GraphFlagValues): void {
  const local = flags['source-file'] !== undefined || flags['source-dir'] !== undefined;
  if (flags['highlight-changes'] === true && local && flags['from-file'] === undefined) {
    throw flowInspectionFailed('Local graph highlighting requires --from-file.');
  }
  if (!local && flags['from-file'] !== undefined) {
    throw flowInspectionFailed('--from-file requires a local --source-file or --source-dir.');
  }
}

function validateFormat(flags: GraphFlagValues): void {
  validateGraphFormatOptions({
    format: flags.format,
    layout: flags.layout,
    curve: flags.curve,
    nodePlacement: flags['node-placement'],
    modelOrder: flags['model-order'],
    cycleBreaking: flags['cycle-breaking'],
    mergeEdges: flags['merge-edges'],
    forceNodeOrder: flags['force-node-order'],
  });
}

async function graphOrg(
  flags: GraphFlagValues,
  progress: Parameters<FlowGraphService['graph']>[1]
): Promise<FlowGraphResult> {
  if (flags['api-name'] === undefined) {
    throw new Error('An API name is required for org-backed Flow graphing.');
  }
  validateNamedFlowFlags({ ...flags, 'api-name': flags['api-name'] });
  const context = createFlowCommandContext(flags);
  return new FlowGraphService(new ToolingFlowDefinitionGateway(context.connection)).graph(
    createRequest(flags, context),
    progress
  );
}

export default class FlowGraph extends SfCommand<FlowGraphResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = flowGraphFlags;

  public async run(): Promise<FlowGraphResult> {
    const flags = await this.parseFlags();
    validateFormat(flags);
    const original = await withFlowProgress(this.spinner, 'graph', async (progress) =>
      flags['source-dir'] !== undefined
        ? graphLocalDirectory(
            {
              directory: flags['source-dir'],
              apiName: flags['api-name'] ?? '',
              namespace: flags.namespace,
              recursive: flags.recursive,
              maxDepth: flags['max-depth'],
            },
            createSourceGraphRequest(flags),
            progress
          )
        : flags['source-file'] === undefined
        ? graphOrg(flags, progress)
        : (progress('loading-source', flags['source-file']),
          loadFlowSource(flags['source-file']).then((source) =>
            graphFlowSource(source, createSourceGraphRequest(flags), progress)
          ))
    );
    const result = await withFlowProgress(this.spinner, 'graph', async (progress) =>
      highlightFlowGraph(flags, original, progress)
    );
    await writeGraphOutput(flags['output-file'], result.graph);
    this.writeHumanOutput(result, flags['output-file']);
    return result;
  }

  public async parseFlags(): Promise<GraphFlagValues> {
    const { flags } = await this.parse(FlowGraph);
    validateGraphComparisonInput(flags);
    validateFlowSourceFlags(this.argv, ['target-org', 'api-version', 'flow-version', 'subflow-version'], 'source-dir');
    validateFlowSourceFlags(this.argv, [
      'target-org',
      'flow-version',
      'subflow-version',
      'recursive',
      'max-depth',
      'namespace',
      'api-version',
    ]);
    return flags;
  }

  private writeHumanOutput(result: FlowGraphResult, outputFile: string | undefined): void {
    if (this.jsonEnabled()) {
      return;
    }
    this.log(outputFile === undefined ? result.graph : messages.getMessage('info.written', [outputFile]));
    for (const warning of result.warnings) {
      this.warn(warningMessages[warning.kind](warning.path.join(' -> ')));
    }
  }
}
