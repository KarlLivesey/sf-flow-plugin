/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { writeFlowBundleFiles } from '../../src/utils/flow-bundle-files.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

describe('Flow bundle file output', (): void => {
  it('refuses existing files unless overwrite is enabled', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-bundle-'));
    const file = join(directory, 'flows/Test.flow-meta.xml');
    try {
      await writeFlowBundleFiles([{ path: file, content: 'first' }], false);
      await expectErrorName(writeFlowBundleFiles([{ path: file, content: 'second' }], false), 'FlowBundleFailed');
      await writeFlowBundleFiles([{ path: file, content: 'second' }], true);
      expect(await readFile(file, 'utf8')).to.equal('second');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
