/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { resolve } from 'node:path';

import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowBundleService } from '../../services/flow-bundle-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type { FlowBundleRequest, FlowBundleResult } from '../../types/flow-bundle.js';
import type { FlowExportStatus, FlowSubflowVersionSelector } from '../../types/flow-inspection.js';
import { writeFlowBundleFiles } from '../../utils/flow-bundle-files.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { withFlowProgress, withFlowProgressStage } from '../../utils/flow-progress.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.bundle');

export interface BundleFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  'subflow-version': FlowSubflowVersionSelector;
  'max-depth': number;
  status: FlowExportStatus;
  'output-dir': string;
  overwrite: boolean;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(
  flags: BundleFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowBundleRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    apiVersion: flags['api-version'] ?? context.connection.version,
    version: flags['flow-version'],
    subflowVersion: flags['subflow-version'],
    maxDepth: flags['max-depth'],
    status: flags.status,
    outputDir: resolve(flags['output-dir']),
    overwrite: flags.overwrite,
  };
}

export default class FlowBundle extends SfCommand<FlowBundleResult> {
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
    'flow-version': Flags.custom<FlowComparisonVersionSelector>({
      default: 'latest',
      summary: messages.getMessage('flags.flow-version.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseInspectionVersionSelector(input)),
    })(),
    'subflow-version': Flags.custom<FlowSubflowVersionSelector>({
      default: 'active',
      options: ['active', 'latest'],
      summary: messages.getMessage('flags.subflow-version.summary'),
    })(),
    'max-depth': Flags.integer({
      default: 10,
      min: 0,
      summary: messages.getMessage('flags.max-depth.summary'),
    }),
    status: Flags.custom<FlowExportStatus>({
      default: 'draft',
      options: ['draft', 'active'],
      summary: messages.getMessage('flags.status.summary'),
    })(),
    'output-dir': Flags.directory({
      required: true,
      exists: false,
      summary: messages.getMessage('flags.output-dir.summary'),
    }),
    overwrite: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.overwrite.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowBundleResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const request = createRequest(flags, context);
    const result = await withFlowProgress(this.spinner, 'bundle', async (progress) => {
      const artifact = await new FlowBundleService(new ToolingFlowDefinitionGateway(context.connection)).bundle(
        request,
        progress
      );
      await withFlowProgressStage(progress, {
        stage: 'writing-files',
        detail: `${artifact.files.length} files to ${request.outputDir}`,
        operation: async () => writeFlowBundleFiles(artifact.files, request.overwrite, request.outputDir),
      });
      return artifact.result;
    });
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<BundleFlagValues> {
    const { flags } = await this.parse(FlowBundle);
    return flags;
  }

  private writeHumanOutput(result: FlowBundleResult): void {
    this.table({
      title: messages.getMessage('info.title', [result.apiName, result.flows.length]),
      data: result.flows.map((flow) => ({ ...flow })),
      columns: [
        { key: 'qualifiedName', name: 'Flow' },
        { key: 'versionNumber', name: 'Version' },
        { key: 'sourceStatus', name: 'Source status' },
        { key: 'exportedStatus', name: 'Exported status' },
        { key: 'file', name: 'File' },
      ],
    });
    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.wrote', [result.outputFiles.length, result.outputDir]));
    }
  }
}
