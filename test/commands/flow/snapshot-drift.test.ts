/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';
import FlowSnapshot from '../../../src/commands/flow/snapshot.js';
import FlowDrift from '../../../src/commands/flow/drift.js';
import { saveFlowSnapshot } from '../../../src/services/flow-snapshot-service.js';
import { ToolingFlowDefinitionGateway } from '../../../src/services/tooling-flow-definition-gateway.js';
import { documentFixture } from '../../helpers/flow-document-fixtures.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

function emptyOrgGateway(): void {
  $$.SANDBOX.stub(ToolingFlowDefinitionGateway.prototype, 'findAllDefinitions').resolves([]);
  $$.SANDBOX.stub(ToolingFlowDefinitionGateway.prototype, 'findAllVersions').resolves([]);
}

describe('Snapshot and drift CLI results', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow snapshot cli '));
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes an empty-org snapshot as an explicit empty inventory', async (): Promise<void> => {
    emptyOrgGateway();
    $$.SANDBOX.stub(FlowSnapshot.prototype, 'parseFlags').resolves({
      'api-name': undefined,
      namespace: undefined,
      'flow-version': 'latest',
      'target-org': createCommandOrg({} as Connection),
      'api-version': undefined,
      'output-dir': directory,
    });
    const result = await FlowSnapshot.run(['--json']);
    expect(result.flows).to.deep.equal([]);
    expect(result.schemaVersion).to.equal(1);
  });

  it('reports a missing selected Flow and sets the requested CI failure status', async (): Promise<void> => {
    emptyOrgGateway();
    await saveFlowSnapshot(
      [documentFixture()],
      { apiNames: ['Root_Flow'], version: 'latest', targetOrg: 'source' },
      directory
    );
    $$.SANDBOX.stub(FlowDrift.prototype, 'parseFlags').resolves({
      snapshot: join(directory, 'snapshot.json'),
      'target-org': createCommandOrg({} as Connection),
      'api-version': undefined,
      'fail-on-drift': true,
    });
    const result = await FlowDrift.run(['--json']);
    expect(result.flows[0]).to.include({ flow: 'managed__Root_Flow', kind: 'missing' });
    expect(process.exitCode).to.equal(1);
    process.exitCode = 0;
  });
});
