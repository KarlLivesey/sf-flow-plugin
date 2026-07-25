/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Org } from '@salesforce/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';

import { FlowAuditService } from '../../services/flow-audit-service.js';
import { ToolingFlowDefinitionGateway } from '../../services/tooling-flow-definition-gateway.js';
import type { FlowAuditResult } from '../../types/flow.js';
import { createFlowCommandContext } from '../../utils/flow-command.js';
import { withFlowProgress } from '../../utils/flow-progress.js';
import { qualifiedFlowName } from '../../utils/flow-state.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.audit');

export interface AuditFlagValues {
  'target-org': Org | undefined;
  'api-version': string | undefined;
}

export default class FlowAudit extends SfCommand<FlowAuditResult> {
  public static override readonly summary = messages.getMessage('summary');
  public static override readonly description = messages.getMessage('description');
  public static override readonly examples = messages.getMessages('examples');

  public static override readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      required: false,
      summary: messages.getMessage('flags.target-org.summary'),
    }),
    'api-version': Flags.orgApiVersion({
      summary: messages.getMessage('flags.api-version.summary'),
    }),
  };

  public async run(): Promise<FlowAuditResult> {
    const flags = await this.parseFlags();
    const context = createFlowCommandContext(flags);
    const service = new FlowAuditService(new ToolingFlowDefinitionGateway(context.connection));
    const result = await withFlowProgress(this.spinner, 'audit', async () => service.audit(context.targetOrg));
    this.writeHumanOutput(result);
    return result;
  }

  public async parseFlags(): Promise<AuditFlagValues> {
    const { flags } = await this.parse(FlowAudit);
    return flags;
  }

  private writeHumanOutput(result: FlowAuditResult): void {
    this.table({
      title: messages.getMessage('info.title', [result.flowsWithIssues, result.definitionsScanned]),
      data: result.flows.map((flow) => ({
        name: qualifiedFlowName(flow.apiName, flow.namespace),
        activeVersion: flow.activeVersion ?? '-',
        latestVersion: flow.latestVersion ?? '-',
        draftVersions: flow.draftVersions,
        obsoleteVersions: flow.obsoleteVersions,
        issues: flow.issues.join(', '),
      })),
      columns: [
        { key: 'name', name: 'Flow' },
        { key: 'activeVersion', name: 'Active' },
        { key: 'latestVersion', name: 'Latest' },
        { key: 'draftVersions', name: 'Draft' },
        { key: 'obsoleteVersions', name: 'Obsolete' },
        { key: 'issues', name: 'Issues' },
      ],
    });
  }
}
