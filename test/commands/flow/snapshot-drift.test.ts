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
import { flowDefinition, flowVersion } from '../../helpers/fake-flow-gateway.js';

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

async function unmanagedDrift(directory: string, options: { keepUnmanaged: boolean; all: boolean }): Promise<void> {
  await saveFlowSnapshot(
    [documentFixture({}, null)],
    {
      apiNames: options.all ? [] : ['Root_Flow'],
      version: 'latest',
      targetOrg: 'source',
    },
    directory
  );
  const definitions = [null, 'pkg']
    .map((namespace, index) => ({
      ...flowDefinition({
        id: '30000000000000' + String(index + 1),
        apiName: 'Root_Flow',
        activeVersionId: null,
        latestVersionId: flowVersion('30000000000000' + String(index + 1), 1, 'Active').id,
      }),
      namespace,
    }))
    .filter((definition) => options.keepUnmanaged || definition.namespace !== null);
  $$.SANDBOX.stub(ToolingFlowDefinitionGateway.prototype, 'findAllDefinitions').resolves(definitions);
  $$.SANDBOX.stub(ToolingFlowDefinitionGateway.prototype, 'findAllVersions').resolves(
    definitions.map((definition) => flowVersion(definition.id, 1, 'Active'))
  );
  const metadata = $$.SANDBOX.stub(ToolingFlowDefinitionGateway.prototype, 'getVersionMetadata').resolves(
    documentFixture().metadata
  );
  $$.SANDBOX.stub(FlowDrift.prototype, 'parseFlags').resolves({
    snapshot: join(directory, 'snapshot.json'),
    'target-org': createCommandOrg({} as Connection),
    'api-version': undefined,
    'fail-on-drift': false,
  });
  const result = await FlowDrift.run(['--json']);
  expect(result.flows.map(({ flow, kind }) => ({ flow, kind }))).to.have.deep.members([
    { flow: 'Root_Flow', kind: options.keepUnmanaged ? 'unchanged' : 'missing' },
    ...(options.all ? [{ flow: 'pkg__Root_Flow', kind: 'added' }] : []),
  ]);
  expect(metadata.callCount).to.equal(Number(options.keepUnmanaged) + Number(options.all));
}

describe('Exact snapshot identities during drift', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow identity drift '));
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });
  for (const options of [
    { keepUnmanaged: true, all: false },
    { keepUnmanaged: false, all: false },
    { keepUnmanaged: true, all: true },
  ]) {
    it('keeps namespace identity with ' + JSON.stringify(options), async (): Promise<void> => {
      await unmanagedDrift(directory, options);
    });
  }
});
