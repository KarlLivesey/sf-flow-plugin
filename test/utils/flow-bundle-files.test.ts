/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { writeFlowBundleFiles } from '../../src/utils/flow-bundle-files.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

describe('Flow bundle file output', (): void => {
  it('refuses existing files unless overwrite is enabled', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-bundle-'));
    const file = join(directory, 'flows/Test.flow-meta.xml');
    try {
      await writeFlowBundleFiles([{ path: file, content: 'first' }], false, directory);
      await expectErrorName(
        writeFlowBundleFiles([{ path: file, content: 'second' }], false, directory),
        'FlowBundleFailed'
      );
      await writeFlowBundleFiles([{ path: file, content: 'second' }], true, directory);
      expect(await readFile(file, 'utf8')).to.equal('second');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Flow bundle file rollback', (): void => {
  it('restores previous files when committing a staged bundle fails', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-bundle-'));
    const first = join(directory, 'flows/First.flow-meta.xml');
    const blocked = join(directory, 'blocked');
    try {
      await writeFlowBundleFiles([{ path: first, content: 'original' }], false, directory);
      await writeFile(blocked, 'not a directory', 'utf8');
      await expectErrorName(
        writeFlowBundleFiles(
          [
            { path: first, content: 'replacement' },
            { path: join(blocked, 'Second.flow-meta.xml'), content: 'second' },
          ],
          true,
          directory
        ),
        'FlowBundleFailed'
      );
      expect(await readFile(first, 'utf8')).to.equal('original');
      expect((await readdir(directory)).filter((file) => file.startsWith('.sf-flow-bundle-stage-'))).to.deep.equal([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('Flow bundle stale file reconciliation', (): void => {
  it('removes stale Flow files owned by the previous bundle manifest', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-bundle-'));
    const oldFlow = join(directory, 'flows/Old_Flow.flow-meta.xml');
    const newFlow = join(directory, 'flows/New_Flow.flow-meta.xml');
    const manifest = join(directory, '.sf-flow-bundle/manifest.json');
    try {
      await writeFlowBundleFiles(
        [
          { path: oldFlow, content: 'old' },
          { path: manifest, content: '{"flows":[{"qualifiedName":"Old_Flow"}]}\n' },
        ],
        false,
        directory
      );
      await writeFlowBundleFiles(
        [
          { path: newFlow, content: 'new' },
          { path: manifest, content: '{"flows":[{"qualifiedName":"New_Flow"}]}\n' },
        ],
        true,
        directory
      );
      expect(await exists(oldFlow)).to.equal(false);
      expect(await readFile(newFlow, 'utf8')).to.equal('new');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
