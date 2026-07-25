/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowPrune from '../../../src/commands/flow/prune.js';
import { FlowPruneService } from '../../../src/services/flow-prune-service.js';
import type { FlowPruneResult } from '../../../src/types/flow.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

const result: FlowPruneResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  keep: 5,
  keepVersions: [21],
  ignoreVersions: [20],
  keepBy: 'modified',
  protectedVersions: [],
  ignoredVersions: [],
  retainedVersions: [],
  plannedDeletions: [],
  deletedVersions: [],
  skippedVersions: [],
  changed: false,
  dryRun: true,
  targetOrg: 'admin@example.com',
};

describe('flow prune safety flags', (): void => {
  it('defaults to a dry run, keeps five and orders by creation date', (): void => {
    expect(FlowPrune.flags['dry-run'].default).to.equal(true);
    expect(FlowPrune.flags['dry-run'].allowNo).to.equal(true);
    expect(FlowPrune.flags.keep.default).to.equal(5);
    expect(FlowPrune.flags['keep-by'].default).to.equal('created');
  });

  it('allows multiple explicitly retained versions', (): void => {
    expect(FlowPrune.flags['keep-version'].multiple).to.equal(true);
    expect(FlowPrune.flags['keep-version'].default).to.deep.equal([]);
    expect(FlowPrune.flags.ignore.multiple).to.equal(true);
    expect(FlowPrune.flags.ignore.default).to.deep.equal([]);
  });
});

describe('flow prune command execution', (): void => {
  it('passes retention and ordering options to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      keep: 5,
      'keep-version': [21],
      ignore: [20],
      'keep-by': 'modified' as const,
      namespace: undefined,
      'api-version': undefined,
      'dry-run': true,
    };
    $$.SANDBOX.stub(FlowPrune.prototype, 'parseFlags').resolves(flags);
    const prune = $$.SANDBOX.stub(FlowPruneService.prototype, 'prune').resolves(result);
    const actual = await FlowPrune.run(['--json']);
    expect(prune.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      keep: 5,
      keepVersions: [21],
      ignoreVersions: [20],
      keepBy: 'modified',
      dryRun: true,
    });
    expect(actual).to.equal(result);
  });
});
