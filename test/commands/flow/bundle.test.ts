/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowBundle from '../../../src/commands/flow/bundle.js';
import { FlowBundleService } from '../../../src/services/flow-bundle-service.js';
import type { FlowBundleArtifact } from '../../../src/types/flow-bundle.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const artifact: FlowBundleArtifact = {
  files: [],
  result: {
    apiName: 'Flow_A',
    namespace: null,
    requestedVersion: 'latest',
    resolvedVersion: 1,
    subflowVersion: 'active',
    maxDepth: 10,
    exportedStatus: 'Draft',
    outputDir: '/tmp/flow-bundle',
    overwrite: false,
    flows: [],
    dependencies: [],
    externalDependencies: [],
    warnings: [],
    outputFiles: [],
    targetOrg: 'admin@example.com',
  },
};

describe('flow bundle command', (): void => {
  it('defaults to Draft and active subflow versions', (): void => {
    expect(FlowBundle.flags.status.default).to.equal('draft');
    expect(FlowBundle.flags['subflow-version'].default).to.equal('active');
    expect(FlowBundle.flags.overwrite.default).to.equal(false);
  });

  it('passes the export selection to the bundle service', async (): Promise<void> => {
    const org = createCommandOrg({ version: '65.0' } as Connection);
    const flags = {
      'api-name': 'Flow_A',
      'target-org': org,
      'flow-version': 'latest' as const,
      'subflow-version': 'active' as const,
      'max-depth': 10,
      status: 'draft' as const,
      'output-dir': '/tmp/flow-bundle',
      overwrite: false,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowBundle.prototype, 'parseFlags').resolves(flags);
    const bundle = $$.SANDBOX.stub(FlowBundleService.prototype, 'bundle').resolves(artifact);
    const actual = await FlowBundle.run(['--json']);
    expect(bundle.firstCall.args[0]).to.include({
      apiName: 'Flow_A',
      targetOrg: 'admin@example.com',
      version: 'latest',
      subflowVersion: 'active',
      status: 'draft',
      overwrite: false,
    });
    expect(actual).to.equal(artifact.result);
  });
});
