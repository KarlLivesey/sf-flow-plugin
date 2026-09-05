/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { explainFlowElement } from '../../services/flow-explain-service.js';
import type { FlowExplainResult } from '../../types/flow-document.js';
import { commandDocument, documentFlags, validateDocumentFlags } from '../../utils/flow-document-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.explain');

export default class FlowExplain extends SfCommand<FlowExplainResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');
  public static override readonly flags = {
    ...documentFlags,
    element: Flags.string({ required: true, summary: messages.getMessage('flags.element.summary') }),
  };

  public async run(): Promise<FlowExplainResult> {
    const { flags } = await this.parse(FlowExplain);
    validateDocumentFlags(this.argv);
    const result = await withFlowProgress(this.spinner, 'explain', async (progress) =>
      explainFlowElement(await commandDocument(flags, progress), flags.element)
    );
    this.table({
      title: result.flow + ' — ' + result.type + ': ' + (result.label ?? result.element),
      data: result.details.map((detail) => ({ ...detail })),
      columns: [
        { key: 'path', name: 'Configuration' },
        { key: 'value', name: 'Value' },
      ],
    });
    this.table({
      title: 'Outgoing paths',
      data: result.outgoing,
      columns: [
        { key: 'target', name: 'Target' },
        { key: 'kind', name: 'Kind' },
        { key: 'label', name: 'Outcome' },
      ],
    });
    return result;
  }
}
