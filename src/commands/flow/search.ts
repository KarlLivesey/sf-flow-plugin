/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { z } from 'zod';
import { searchFlowDocuments, type FlowSearchKind } from '../../services/flow-search-service.js';
import type { FlowSearchResult } from '../../types/flow-document.js';
import { commandDocuments, documentFlags, validateDocumentFlags } from '../../utils/flow-document-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.search');

export default class FlowSearch extends SfCommand<FlowSearchResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');
  public static override readonly flags = {
    ...documentFlags,
    query: Flags.string({
      required: true,
      summary: messages.getMessage('flags.query.summary'),
      parse: (input: string): Promise<string> => Promise.resolve(z.string().trim().min(1).parse(input)),
    }),
    kind: Flags.custom<FlowSearchKind>({
      default: 'text',
      options: ['text', 'object', 'field', 'apex', 'subflow'],
      summary: messages.getMessage('flags.case-sensitive.summary'),
    })(),
    'case-sensitive': Flags.boolean({ default: false, summary: messages.getMessage('flags.case-sensitive.summary') }),
  };

  public async run(): Promise<FlowSearchResult> {
    const { flags } = await this.parse(FlowSearch);
    validateDocumentFlags(this.argv);
    const result = await withFlowProgress(this.spinner, 'search', async (progress) =>
      searchFlowDocuments(await commandDocuments(flags, progress), flags.query, {
        kind: flags.kind,
        caseSensitive: flags['case-sensitive'],
      })
    );
    this.table({
      data: result.matches.map((match) => ({ ...match })),
      columns: [
        { key: 'flow', name: 'Flow' },
        { key: 'element', name: 'Element' },
        { key: 'path', name: 'Metadata path' },
        { key: 'value', name: 'Value' },
      ],
    });
    return result;
  }
}
