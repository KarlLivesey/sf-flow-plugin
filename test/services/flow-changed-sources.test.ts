/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect } from 'chai';
import sinon from 'sinon';

import { changedFlowSources } from '../../src/services/flow-changed-sources.js';
import { loadFlowSourceDirectory } from '../../src/services/flow-source-directory-service.js';
import { lintSourceDirectory } from '../../src/services/flow-source-directory-runner.js';
import { flowGitEnvironment } from '../../src/utils/flow-git-environment.js';

const execute = promisify(execFile);
const xml = (child = ''): string =>
  `<Flow xmlns="http://soap.sforce.com/2006/04/metadata"><label>Example</label><processType>AutoLaunchedFlow</processType><status>Draft</status>${
    child === '' ? '' : `<subflows><name>Call</name><flowName>${child}</flowName></subflows>`
  }</Flow>`;

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'flow changed sources '));
  await execute('git', ['init', '-q', directory], { env: flowGitEnvironment() });
  await writeFile(join(directory, 'managed__Child.flow-meta.xml'), xml());
  await writeFile(join(directory, 'managed__Parent.flow-meta.xml'), xml('Child'));
  await writeFile(join(directory, 'Unrelated.flow-meta.xml'), xml());
  await execute('git', ['add', '.'], { cwd: directory, env: flowGitEnvironment() });
  await execute(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgSign=false',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: directory, env: flowGitEnvironment() }
  );
  return directory;
}

async function verifyEmptyRun(directory: string): Promise<void> {
  const unexpected = (): Promise<never> => Promise.reject(new Error('No analyser should run for an unchanged tree.'));
  const result = await lintSourceDirectory({
    sourceDirectory: directory,
    changedSince: 'HEAD',
    rules: [],
    excludedRules: [],
    analyzer: { analyse: unexpected },
    prepareAnalyzer: unexpected,
    progress: (): void => undefined,
  });
  expect(result.flows).to.deep.equal([]);
}

describe('changed Flow source selection', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await createFixture();
  });
  afterEach(async (): Promise<void> => rm(directory, { recursive: true, force: true }));

  it('returns no roots for an unchanged tree', async (): Promise<void> => {
    expect(await changedFlowSources(await loadFlowSourceDirectory(directory), { changedSince: 'HEAD' })).to.deep.equal(
      []
    );
    await verifyEmptyRun(directory);
  });

  it('includes namespaced callers of changed and renamed-away Flows', async (): Promise<void> => {
    await rename(join(directory, 'managed__Child.flow-meta.xml'), join(directory, 'managed__Renamed.flow-meta.xml'));
    await execute('git', ['add', '.'], { cwd: directory, env: flowGitEnvironment() });
    const sources = await changedFlowSources(await loadFlowSourceDirectory(directory), {
      changedSince: 'HEAD',
      includeCallers: true,
    });
    expect(sources.map((source) => source.apiName)).to.have.members(['Parent', 'Renamed']);
  });

  it('includes unstaged changes and leaves unchanged definitions available', async (): Promise<void> => {
    await writeFile(join(directory, 'managed__Child.flow-meta.xml'), xml().replace('Example', 'Updated'));
    const loaded = await loadFlowSourceDirectory(directory);
    expect((await changedFlowSources(loaded, { changedSince: 'HEAD' })).map((source) => source.apiName)).to.deep.equal([
      'Child',
    ]);
    expect(loaded.sources).to.have.length(3);
  });

  it('rejects invalid references rather than reporting a clean result', async (): Promise<void> => {
    const error: unknown = await changedFlowSources(await loadFlowSourceDirectory(directory), {
      changedSince: '--invalid',
    }).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowSourceInvalid');
  });
});

describe('Git hook environment isolation', (): void => {
  it('creates and reads a separate fixture without changing the inherited repository', async (): Promise<void> => {
    const outer = await createFixture();
    const environment = sinon.stub(process, 'env').value({
      ...process.env,
      GIT_DIR: join(outer, '.git'),
      GIT_WORK_TREE: outer,
      GIT_INDEX_FILE: join(outer, '.git', 'index'),
    });
    try {
      await verifyIsolatedFixture(outer);
    } finally {
      environment.restore();
      await rm(outer, { recursive: true, force: true });
    }
  });
});

async function verifyIsolatedFixture(outer: string): Promise<void> {
  const options = { cwd: outer, env: flowGitEnvironment() };
  const before = await execute('git', ['rev-parse', 'HEAD'], options);
  const inner = await createFixture();
  try {
    await writeFile(join(inner, 'managed__Child.flow-meta.xml'), xml().replace('Example', 'Changed'));
    const selected = await changedFlowSources(await loadFlowSourceDirectory(inner), { changedSince: 'HEAD' });
    expect(selected.map((source) => source.apiName)).to.deep.equal(['Child']);
    expect((await execute('git', ['rev-parse', 'HEAD'], options)).stdout).to.equal(before.stdout);
    expect((await execute('git', ['status', '--porcelain'], options)).stdout).to.equal('');
  } finally {
    await rm(inner, { recursive: true, force: true });
  }
}
