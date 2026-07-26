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
  maxInactiveVersions: 0,
  olderThanDays: null,
  types: [],
  namespace: null,
  flows: [],
};

describe('flow audit command', (): void => {
  it('uses the default target org resolver when the flag is omitted', (): void => {
    expect(FlowAudit.flags['target-org'].required).to.equal(false);
    expect(FlowAudit.summary).to.contain('Audit');
  });
});

describe('flow audit command execution', (): void => {
  it('passes the authenticated username to the audit service', async (): Promise<void> => {
    const flags = {
      'target-org': createCommandOrg({} as Connection),
      'api-name': ['Order_Processing'],
      type: ['AutoLaunchedFlow'],
      namespace: 'example',
      'fail-on-findings': false,
      'max-inactive-versions': 3,
      'older-than': { days: 30 },
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowAudit.prototype, 'parseFlags').resolves(flags);
    const audit = $$.SANDBOX.stub(FlowAuditService.prototype, 'audit').resolves(result);
    const actual = await FlowAudit.run(['--json']);
    expect(audit.calledOnce).to.equal(true);
    expect(audit.firstCall.args[0]).to.deep.equal({
      targetOrg: 'admin@example.com',
      apiNames: ['Order_Processing'],
      types: ['AutoLaunchedFlow'],
      namespace: 'example',
      maxInactiveVersions: 3,
      olderThanDays: 30,
    });
    expect(audit.firstCall.args[1]).to.be.a('function');
    expect(actual).to.equal(result);
  });

  it('sets a failing process status when requested and findings are present', async (): Promise<void> => {
    const flags = {
      'target-org': createCommandOrg({} as Connection),
      'api-name': undefined,
      type: undefined,
      namespace: undefined,
      'fail-on-findings': true,
      'max-inactive-versions': 0,
      'older-than': undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowAudit.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowAuditService.prototype, 'audit').resolves({ ...result, flowsWithIssues: 1 });
    try {
      await FlowAudit.run(['--json']);
      expect(process.exitCode).to.equal(1);
    } finally {
      process.exitCode = undefined;
    }
  });
});
