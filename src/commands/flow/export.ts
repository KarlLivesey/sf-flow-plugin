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

import { FlowExportService } from '../../services/flow-export-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowComparisonVersionSelector } from '../../types/flow-analysis.js';
import type {
  FlowExportFormat,
  FlowExportRequest,
  FlowExportResult,
  FlowExportStatus,
} from '../../types/flow-inspection.js';
import { createFlowCommandContext, createNamedFlowRequest, validateNamedFlowFlags } from '../../utils/flow-command.js';
import { writeFlowExport } from '../../utils/flow-export-file.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { parseInspectionVersionSelector } from './describe.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.export');

export interface ExportFlagValues {
  'api-name': string;
  'target-org': Org | undefined;
  'flow-version': FlowComparisonVersionSelector;
  format: FlowExportFormat;
  status: FlowExportStatus;
  'output-file': string;
  namespace: string | undefined;
  'api-version': string | undefined;
}

function createRequest(
  flags: ExportFlagValues,
  context: ReturnType<typeof createFlowCommandContext>
): FlowExportRequest {
  return {
    ...createNamedFlowRequest(flags, context),
    version: flags['flow-version'],
    format: flags.format,
    status: flags.status,
    outputFile: resolve(flags['output-file']),
  };
}

export default class FlowExport extends SfCommand<FlowExportResult> {
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
      default: 'active',
      summary: messages.getMessage('flags.flow-version.summary'),
      parse: (input: string): Promise<FlowComparisonVersionSelector> =>
        Promise.resolve(parseInspectionVersionSelector(input)),
    })(),
    format: Flags.custom<FlowExportFormat>({
      default: 'xml',
      options: ['xml'],
      summary: messages.getMessage('flags.format.summary'),
    })(),
    status: Flags.custom<FlowExportStatus>({
      default: 'draft',
      options: ['active', 'draft'],
      summary: messages.getMessage('flags.status.summary'),
    })(),
    'output-file': Flags.string({
      required: true,
      summary: messages.getMessage('flags.output-file.summary'),
    }),
    namespace: Flags.string({
      summary: messages.getMessage('flags.namespace.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowExportResult> {
    const flags = await this.parseFlags();
    validateNamedFlowFlags(flags);
    const context = createFlowCommandContext(flags);
    const service = new FlowExportService(new ToolingFlowDefinitionGateway(context.connection));
    const artifact = await withFlowProgress(this.spinner, 'export', async (progress) =>
      service.export(createRequest(flags, context), progress)
    );
    const outputFile = await writeFlowExport(artifact.result.outputFile, artifact.content);
    const result = { ...artifact.result, outputFile };
    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.written', [result.apiName, result.resolvedVersion, outputFile]));
    }
    return result;
  }

  public async parseFlags(): Promise<ExportFlagValues> {
    const { flags } = await this.parse(FlowExport);
    return flags;
  }
}
