/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import { resolveSfCliEntry } from '../../src/services/sf-cli-entry.js';
import { SfCodeAnalyzerProcessRunner } from '../../src/services/salesforce-code-analyzer-flow-service.js';

async function fakeCli(directory: string): Promise<string> {
  const root = join(directory, 'node_modules', '@salesforce', 'cli');
  const entry = join(root, 'bin', 'run.js');
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@salesforce/cli',
      bin: { sf: './bin/run.js' },
      type: 'module',
    })
  );
  await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
  await writeFile(join(directory, 'sf.cmd'), '@echo This shim must never run');
  return entry;
}

describe('Salesforce CLI JavaScript dispatch', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'sf shim with spaces & ')));
  });
  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('resolves an npm Windows shim installation without executing the shim', async (): Promise<void> => {
    const entry = await fakeCli(directory);
    const resolved = await resolveSfCliEntry({ hostScript: join(directory, 'sf.cmd'), searchPath: directory });
    const runner = new SfCodeAnalyzerProcessRunner(async () => resolved);
    await Promise.all(
      [
        ['plugins', '--json'],
        ['plugins', 'install', '@salesforce/plugin-code-analyzer'],
        [
          'code-analyzer',
          'run',
          '--workspace',
          join(directory, 'Flow & one.xml'),
          '--rule-selector',
          'flow:(a & b);echo',
        ],
      ].map(async (args) => {
        expect(JSON.parse((await runner.run(args, directory)).stdout)).to.deep.equal(args);
      })
    );
    expect(resolved).to.equal(entry);
  });

  it('uses the hosting CLI entry rather than an unrelated CLI on PATH', async (): Promise<void> => {
    const entry = await fakeCli(directory);
    expect(await resolveSfCliEntry({ hostScript: entry, searchPath: '' })).to.equal(entry);
  });

  it('follows a POSIX CLI symlink to the owning package', async (): Promise<void> => {
    const entry = await fakeCli(directory);
    await symlink(entry, join(directory, 'sf'));
    expect(await resolveSfCliEntry({ hostScript: join(directory, 'sf'), searchPath: '' })).to.equal(entry);
  });

  it('fails clearly when no CLI package can be resolved', async (): Promise<void> => verifyMissingCli(directory));
});

async function verifyMissingCli(directory: string): Promise<void> {
  try {
    await resolveSfCliEntry({ hostScript: join(directory, 'missing'), searchPath: directory });
    expect.fail('Expected missing CLI rejection.');
  } catch (error: unknown) {
    expect(error).to.have.property('message').that.contains('Could not locate');
  }
}
