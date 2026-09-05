/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import { SfCommand } from '@salesforce/sf-plugins-core';
import { inspectFlowResources } from '../../services/flow-resources-service.js';
import type { FlowResourcesResult } from '../../types/flow-document.js';
import { commandDocument, documentFlags, validateDocumentFlags } from '../../utils/flow-document-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.resources');

export default class FlowResources extends SfCommand<FlowResourcesResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');
  public static override readonly flags = documentFlags;

  public async run(): Promise<FlowResourcesResult> {
    const { flags } = await this.parse(FlowResources);
    validateDocumentFlags(this.argv);
    const result = await withFlowProgress(this.spinner, 'resources', async (progress) =>
      inspectFlowResources(await commandDocument(flags, progress))
    );
    this.table({
      title: result.flow,
      data: result.resources.map((resource) => ({
        ...resource,
        usage: resource.usedBy.map((location) => location.path).join(', ') || 'No static references',
      })),
      columns: [
        { key: 'name', name: 'Resource' },
        { key: 'kind', name: 'Kind' },
        { key: 'dataType', name: 'Type' },
        { key: 'usage', name: 'Used by' },
      ],
    });
    return result;
  }
}
