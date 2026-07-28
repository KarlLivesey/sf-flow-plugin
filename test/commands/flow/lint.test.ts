/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowLint from '../../../src/commands/flow/lint.js';
import { FlowLintService } from '../../../src/services/flow-lint-service.js';
import type { FlowLintResult } from '../../../src/types/flow-lint.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';

const result: FlowLintResult = {
  apiName: 'Root_Flow',
  namespace: null,
  definitionId: '300000000000001',
  requestedVersion: 'latest',
  resolvedVersion: 2,
  status: 'Draft',
  findings: [],
  newFindings: [],
  baselineFindings: [],
  errors: 0,
  warnings: 0,
  newErrors: 0,
  newWarnings: 0,
  targetOrg: 'admin@example.com',
};

function flags(): {
  'api-name': string;
  'source-file': undefined;
  'target-org': ReturnType<typeof createCommandOrg>;
  'flow-version': 'latest';
  'fail-on': undefined;
  rule: undefined;
  'exclude-rule': undefined;
  'result-format': 'human';
  'output-file': undefined;
  baseline: undefined;
  namespace: undefined;
  'api-version': undefined;
} {
  return {
    'api-name': 'Root_Flow',
    'source-file': undefined,
    'target-org': createCommandOrg({} as Connection),
    'flow-version': 'latest',
    'fail-on': undefined,
    rule: undefined,
    'exclude-rule': undefined,
    'result-format': 'human',
    'output-file': undefined,
    baseline: undefined,
    namespace: undefined,
    'api-version': undefined,
  };
}

describe('flow lint command', (): void => {
  it('defaults to linting the latest Flow version', (): void => {
    expect(FlowLint.flags['flow-version'].default).to.equal('latest');
    expect(FlowLint.flags['target-org'].required).not.to.equal(true);
  });

  it('passes the requested Flow to the lint service', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowLint.prototype, 'parseFlags').resolves(flags());
    const lint = $$.SANDBOX.stub(FlowLintService.prototype, 'lint').resolves(result);
    const actual = await FlowLint.run(['--json']);
    expect(lint.firstCall.args[0]).to.deep.equal({
      apiName: 'Root_Flow',
      targetOrg: 'admin@example.com',
      version: 'latest',
      rules: [],
      excludedRules: [],
    });
    expect(actual).to.equal(result);
  });
});

describe('flow lint command qualified output', (): void => {
  it('qualifies the clean message', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowLint.prototype, 'parseFlags').resolves(flags());
    $$.SANDBOX.stub(FlowLintService.prototype, 'lint').resolves({ ...result, namespace: 'managed' });
    await FlowLint.run([]);
    expect(commandUx.log.firstCall.args[0]).to.contain('managed__Root_Flow v2');
  });

  it('qualifies the findings table title', async (): Promise<void> => {
    const finding = {
      fingerprint: 'a'.repeat(64),
      rule: 'unused-resource' as const,
      severity: 'warning' as const,
      message: 'A resource is unused.',
      element: 'Unused',
      path: null,
    };
    $$.SANDBOX.stub(FlowLint.prototype, 'parseFlags').resolves(flags());
    $$.SANDBOX.stub(FlowLintService.prototype, 'lint').resolves({
      ...result,
      namespace: 'managed',
      findings: [finding],
      newFindings: [finding],
      warnings: 1,
      newWarnings: 1,
    });
    await FlowLint.run([]);
    expect(commandUx.table.firstCall.args[0].title).to.contain('managed__Root_Flow v2');
  });
});
