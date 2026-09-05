/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import FlowSearch from '../../../src/commands/flow/search.js';
import FlowResources from '../../../src/commands/flow/resources.js';
import FlowExplain from '../../../src/commands/flow/explain.js';
import FlowGraph from '../../../src/commands/flow/graph.js';
import FlowCompare from '../../../src/commands/flow/compare.js';
import { renderFlowMetadataXmlForComparison } from '../../../src/utils/flow-metadata-xml.js';
import { documentFixture } from '../../helpers/flow-document-fixtures.js';
import { expectErrorName } from '../../helpers/fake-flow-gateway.js';

async function writeDiscoveryFile(file: string): Promise<void> {
  await writeFile(
    file,
    renderFlowMetadataXmlForComparison(
      documentFixture({
        constants: [{ name: 'Greeting', dataType: 'String', value: { stringValue: 'Hello' } }],
        recordLookups: [{ name: 'Find_Account', object: 'Account' }],
      }).metadata
    )
  );
}

describe('Flow search flag help', (): void => {
  it('distinguishes reference-kind filtering from case sensitivity', (): void => {
    expect(FlowSearch.flags.kind.summary).to.equal('Restrict matches to a kind of metadata reference.');
    expect(FlowSearch.flags['case-sensitive'].summary).to.equal('Match letter case exactly.');
  });
});

describe('Local Flow discovery commands', (): void => {
  let directory: string;
  let file: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow discovery cli '));
    file = join(directory, 'managed__Root_Flow.flow-meta.xml');
    await writeDiscoveryFile(file);
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('searches local XML without an org and returns qualified JSON identities', async (): Promise<void> => {
    const result = await FlowSearch.run([
      '--source-dir',
      directory,
      '--query',
      'Account',
      '--kind',
      'object',
      '--json',
    ]);
    expect(result.matches[0]?.flow).to.equal('managed__Root_Flow');
  });

  it('returns resources from a single local file', async (): Promise<void> => {
    const result = await FlowResources.run(['--source-file', file, '--json']);
    expect(result.resources[0]?.name).to.equal('Greeting');
  });

  it('explains local record configuration', async (): Promise<void> => {
    const result = await FlowExplain.run(['--source-file', file, '--element', 'Find_Account', '--json']);
    expect(result.type).to.equal('Record Lookup');
    expect(result.details.some((detail) => detail.value === 'Account')).to.equal(true);
  });

  it('rejects explicit org flags in source mode', async (): Promise<void> => {
    await expectErrorName(
      FlowResources.run(['--source-file', file, '--flow-version', 'latest', '--json']),
      'FlowSourceInvalid'
    );
  });
});

describe('Local Flow graph and interface command paths', (): void => {
  let directory: string;
  let root: string;
  let child: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow recursive graph '));
    root = join(directory, 'managed__Root_Flow.flow-meta.xml');
    child = join(directory, 'managed__Child_Flow.flow-meta.xml');
    await writeFile(
      root,
      renderFlowMetadataXmlForComparison(
        documentFixture({ subflows: [{ name: 'Call', flowName: 'Child_Flow' }] }).metadata
      )
    );
    await writeFile(child, renderFlowMetadataXmlForComparison(documentFixture().metadata));
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('resolves local subflows within the caller namespace', async (): Promise<void> => {
    const result = await FlowGraph.run([
      '--source-dir',
      directory,
      '--api-name',
      'managed__Root_Flow',
      '--recursive',
      '--json',
    ]);
    expect(result.flows.map((flow) => flow.qualifiedName)).to.deep.equal(['managed__Root_Flow', 'managed__Child_Flow']);
    expect(result.targetOrg).to.equal(null);
    expect(result.sourceDirectory).to.equal(await realpath(directory));
  });

  it('reports missing local subflows and depth truncation', async (): Promise<void> =>
    checkMissingSubflows(directory, child));

  it('ignores implementation differences with --interface-only', async (): Promise<void> => {
    const previousDir = await mkdtemp(join(directory, 'previous '));
    const previous = join(previousDir, 'managed__Root_Flow.flow-meta.xml');
    await writeFile(previous, renderFlowMetadataXmlForComparison(documentFixture().metadata));
    const result = await FlowCompare.run(['--from-file', previous, '--to-file', root, '--interface-only', '--json']);
    expect(result.different).to.equal(false);
    expect(result.interfaceOnly).to.equal(true);
  });
});

async function checkMissingSubflows(directory: string, child: string): Promise<void> {
  const limited = await FlowGraph.run([
    '--source-dir',
    directory,
    '--api-name',
    'managed__Root_Flow',
    '--recursive',
    '--max-depth',
    '0',
    '--json',
  ]);
  expect(limited.warnings[0]?.kind).to.equal('depth-limit');
  await rm(child);
  const missing = await FlowGraph.run([
    '--source-dir',
    directory,
    '--api-name',
    'managed__Root_Flow',
    '--recursive',
    '--json',
  ]);
  expect(missing.warnings[0]?.kind).to.equal('missing-subflow');
}
