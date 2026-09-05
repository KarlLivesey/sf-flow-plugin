/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { saveFlowSnapshot } from '../../src/services/flow-snapshot-service.js';
import { readFlowSnapshot } from '../../src/services/flow-snapshot-reader.js';
import { inspectFlowDrift } from '../../src/services/flow-drift-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';
import { documentFixture } from '../helpers/flow-document-fixtures.js';

describe('Flow snapshot and drift', (): void => {
  let directory: string;
  const selection = { apiNames: ['Root_Flow'], version: 'latest' as const, targetOrg: 'admin@example.com' };
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow snapshot '));
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('captures qualified identity, exact status, resolved version and readable XML', async (): Promise<void> => {
    const result = await saveFlowSnapshot([documentFixture()], selection, directory);
    const loaded = await readFlowSnapshot(join(directory, 'snapshot.json'));
    expect(result.selection.apiNames).to.deep.equal(['managed__Root_Flow']);
    expect(loaded.sources[0]?.description.status).to.equal('Active');
    expect(result.flows[0]?.version).to.equal(1);
    expect((await inspectFlowDrift(loaded, [documentFixture()], 'other@example.com')).different).to.equal(false);
  });

  it('reports changed, missing and additional Flows', async (): Promise<void> => {
    await saveFlowSnapshot([documentFixture()], selection, directory);
    const loaded = await readFlowSnapshot(join(directory, 'snapshot.json'));
    const changed = await inspectFlowDrift(loaded, [documentFixture({ description: 'Changed' })], selection.targetOrg);
    expect(changed.flows[0]?.kind).to.equal('changed');
    const replaced = await inspectFlowDrift(loaded, [documentFixture({}, null)], selection.targetOrg);
    expect(replaced.flows.map((flow) => flow.kind)).to.have.members(['added', 'missing']);
  });

  it('refuses overwritten snapshot files and leaves their contents intact', async (): Promise<void> => {
    await saveFlowSnapshot([documentFixture()], selection, directory);
    const original = await readFile(join(directory, 'snapshot.json'), 'utf8');
    await expectErrorName(
      saveFlowSnapshot([documentFixture({ description: 'New' })], selection, directory),
      'FlowBundleFailed'
    );
    expect(await readFile(join(directory, 'snapshot.json'), 'utf8')).to.equal(original);
  });

  it('rejects modified XML before comparisons', async (): Promise<void> => rejectModifiedSnapshot(directory));

  it('rejects path traversal in untrusted manifests', async (): Promise<void> => rejectSnapshotTraversal(directory));

  it('rejects symbolic-link source files', async (): Promise<void> => rejectSnapshotSymlink(directory));
});

async function rejectModifiedSnapshot(directory: string): Promise<void> {
  const selection = { apiNames: ['Root_Flow'], version: 'latest' as const, targetOrg: 'admin@example.com' };
  await saveFlowSnapshot([documentFixture()], selection, directory);
  await writeFile(join(directory, 'flows', 'managed__Root_Flow.flow-meta.xml'), '<Flow/>');
  await expectErrorName(readFlowSnapshot(join(directory, 'snapshot.json')), 'FlowInspectionFailed');
}

async function rejectSnapshotTraversal(directory: string): Promise<void> {
  const selection = { apiNames: ['Root_Flow'], version: 'latest' as const, targetOrg: 'admin@example.com' };
  const manifest = await saveFlowSnapshot([documentFixture()], selection, directory);
  await writeFile(
    join(directory, 'snapshot.json'),
    JSON.stringify({
      ...manifest,
      flows: manifest.flows.map((flow) => ({ ...flow, file: '../outside.flow-meta.xml' })),
    })
  );
  await expectErrorName(readFlowSnapshot(join(directory, 'snapshot.json')), 'FlowInspectionFailed');
}

async function rejectSnapshotSymlink(directory: string): Promise<void> {
  const selection = { apiNames: ['Root_Flow'], version: 'latest' as const, targetOrg: 'admin@example.com' };
  await saveFlowSnapshot([documentFixture()], selection, directory);
  const file = join(directory, 'flows', 'managed__Root_Flow.flow-meta.xml');
  await rm(file);
  await symlink(join(directory, 'snapshot.json'), file);
  await expectErrorName(readFlowSnapshot(join(directory, 'snapshot.json')), 'FlowInspectionFailed');
}
