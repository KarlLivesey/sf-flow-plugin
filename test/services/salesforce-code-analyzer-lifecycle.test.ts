/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect } from 'chai';

import {
  SalesforceCodeAnalyzerFlowService,
  type CodeAnalyzerProcessRunner,
} from '../../src/services/salesforce-code-analyzer-flow-service.js';
import type { AnalyzerTemporaryDirectory } from '../../src/services/analyzer-temporary-directory.js';

const retainedDirectories: string[] = [];

class FakeProcessRunner implements CodeAnalyzerProcessRunner {
  public constructor(private readonly handler: (args: ReadonlyArray<string>) => Promise<string>) {}

  public async run(args: ReadonlyArray<string>): Promise<{ stdout: string }> {
    return { stdout: await this.handler(args) };
  }
}

afterEach(async (): Promise<void> => {
  await Promise.all(
    retainedDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function retainedTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sf-flow-code-analyzer-retained-'));
  retainedDirectories.push(directory);
  return directory;
}

function validAnalyzerOutput(sourceFile: string): object {
  return {
    runDir: resolve('.'),
    violations: [
      {
        rule: 'MissingDescription',
        engine: 'flow',
        severity: 4,
        tags: ['CodeStyle'],
        primaryLocationIndex: 0,
        locations: [{ file: sourceFile, startLine: 1, startColumn: 1 }],
        message: 'Add a description.',
      },
    ],
  };
}

function failedCleanupDirectory(): AnalyzerTemporaryDirectory {
  return {
    create: retainedTemporaryDirectory,
    remove: async (): Promise<void> => {
      throw new Error('Cleanup failed.');
    },
  };
}

describe('SalesforceCodeAnalyzerFlowService cleanup lifecycle', (): void => {
  it('preserves the sanitised analysis error and reports failed cleanup', async (): Promise<void> => {
    const runner = new FakeProcessRunner(async (): Promise<string> => {
      throw new Error('sensitive Analyzer process failure');
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner, process.cwd(), failedCleanupDirectory());

    const error = await service
      .analyse({ sourceFile: resolve('Example.flow-meta.xml'), rules: [], excludedRules: [] })
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowCodeAnalyzerFailed');
    expect(error).to.have.property('message').that.includes('could not analyse the local Flow source file');
    expect(error).to.have.property('message').that.includes('Temporary cleanup also failed');
    expect(error).to.have.property('message').that.includes('sf-flow-code-analyzer-');
    expect(error).to.have.property('message').that.does.not.include('sensitive Analyzer process failure');
  });

  it('reports a retained directory when cleanup fails after successful analysis', async (): Promise<void> => {
    const sourceFile = resolve('Example.flow-meta.xml');
    const runner = new FakeProcessRunner(async (args): Promise<string> => {
      const outputFile = args[args.indexOf('--output-file') + 1];
      if (outputFile !== undefined) {
        await writeFile(outputFile, JSON.stringify(validAnalyzerOutput(sourceFile)), 'utf8');
      }
      return '';
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner, process.cwd(), failedCleanupDirectory());

    const error = await service
      .analyse({ sourceFile, rules: [], excludedRules: [] })
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowCodeAnalyzerFailed');
    expect(error).to.have.property('message').that.includes('sf-flow-code-analyzer-');
  });
});

describe('SalesforceCodeAnalyzerFlowService creation lifecycle', (): void => {
  it('wraps creation failures without inventing a retained path', async (): Promise<void> => {
    const service = new SalesforceCodeAnalyzerFlowService(
      new FakeProcessRunner(async (): Promise<string> => ''),
      process.cwd(),
      {
        create: async (): Promise<string> => {
          throw new Error('sensitive filesystem failure');
        },
        remove: async (): Promise<void> => undefined,
      }
    );

    const error = await service
      .analyse({ sourceFile: resolve('Example.flow-meta.xml'), rules: [], excludedRules: [] })
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowCodeAnalyzerFailed');
    expect(error).to.have.property('message').that.includes('could not create its temporary working directory');
    expect(error).to.have.property('message').that.does.not.include('sensitive filesystem failure');
    expect(error).to.have.property('message').that.does.not.include('retained');
  });
});
