/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowAudit from '../../../src/commands/flow/audit.js';
import { FlowAuditService } from '../../../src/services/flow-audit-service.js';
import type { FlowAuditResult } from '../../../src/types/flow.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowAuditResult = {
  targetOrg: 'admin@example.com',
  definitionsScanned: 0,
  flowsWithIssues: 0,
  flows: [],
};

describe('flow audit command', (): void => {
  it('uses the default target org resolver when the flag is omitted', (): void => {
    expect(FlowAudit.flags['target-org'].required).to.equal(false);
    expect(FlowAudit.summary).to.contain('Audit');
  });

  it('passes the authenticated username to the audit service', async (): Promise<void> => {
    const flags = {
      'target-org': createCommandOrg({} as Connection),
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowAudit.prototype, 'parseFlags').resolves(flags);
    const audit = $$.SANDBOX.stub(FlowAuditService.prototype, 'audit').resolves(result);
    const actual = await FlowAudit.run(['--json']);
    expect(audit.calledOnceWithExactly('admin@example.com')).to.equal(true);
    expect(actual).to.equal(result);
  });
});
