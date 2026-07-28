/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect } from 'chai';

import {
  ensureSalesforceCodeAnalyzer,
  SalesforceCodeAnalyzerFlowService,
} from '../../src/services/salesforce-code-analyzer-flow-service.js';
import type { CodeAnalyzerProcessRunner } from '../../src/services/salesforce-code-analyzer-flow-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';

const CODE_ANALYZER_PLUGIN_FOR_TEST = '@salesforce/plugin-code-analyzer';

class FakeProcessRunner implements CodeAnalyzerProcessRunner {
  public readonly calls: string[][] = [];

  public constructor(private readonly handler: (args: ReadonlyArray<string>) => Promise<string>) {}

  public async run(args: ReadonlyArray<string>): Promise<{ stdout: string }> {
    this.calls.push([...args]);
    return { stdout: await this.handler(args) };
  }
}

function analyzerOutput(sourceFile: string): object {
  return {
    runDir: resolve('.'),
    violations: [
      {
        rule: 'MissingDescription',
        engine: 'flow',
        severity: 4,
        tags: ['CodeStyle', 'XML'],
        primaryLocationIndex: 1,
        locations: [
          { file: sourceFile, startLine: 2, startColumn: 1 },
          { file: sourceFile, startLine: 4, startColumn: 3, endLine: 4, endColumn: 9 },
        ],
        message: 'Add a description.',
      },
      {
        rule: 'DMLStatementInLoop',
        engine: 'flow',
        severity: 2,
        tags: ['Performance', 'XML'],
        primaryLocationIndex: 0,
        locations: [{ file: sourceFile, startLine: 20, startColumn: 1 }],
        message: 'Move DML outside the loop.',
      },
    ],
  };
}

describe('SalesforceCodeAnalyzerFlowService', (): void => {
  it('runs selected Flow Scanner rules and maps complete Analyzer locations', async (): Promise<void> => {
    const sourceFile = resolve('Example.flow-meta.xml');
    const runner = new FakeProcessRunner(async (args) => {
      const outputFile = args[args.indexOf('--output-file') + 1];
      if (outputFile !== undefined) {
        await writeFile(outputFile, JSON.stringify(analyzerOutput(sourceFile)), 'utf8');
      }
      return '';
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner);
    const findings = await service.analyse({
      sourceFile,
      rules: ['MissingDescription'],
      excludedRules: ['DMLStatementInLoop'],
    });

    expect(runner.calls[0]).to.include.members(['--rule-selector', 'flow:MissingDescription']);
    expect(findings).to.have.length(1);
    expect(findings[0]).to.include({
      rule: 'MissingDescription',
      severity: 'warning',
      analyzerSeverity: 4,
      path: 'line 4:3',
    });
    expect(findings[0]?.locations).to.deep.include({
      file: sourceFile,
      startLine: 4,
      startColumn: 3,
      endLine: 4,
      endColumn: 9,
      primary: true,
    });
  });
});

describe('SalesforceCodeAnalyzerFlowService defaults and failures', (): void => {
  it('uses every Flow Scanner rule by default and maps high severity to an error', async (): Promise<void> => {
    const sourceFile = resolve('Example.flow-meta.xml');
    const runner = new FakeProcessRunner(async (args) => {
      const outputFile = args[args.indexOf('--output-file') + 1];
      if (outputFile !== undefined) {
        await writeFile(outputFile, JSON.stringify(analyzerOutput(sourceFile)), 'utf8');
      }
      return '';
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner);
    const findings = await service.analyse({ sourceFile, rules: [], excludedRules: ['MissingDescription'] });

    expect(runner.calls[0]).to.include.members(['--rule-selector', 'flow']);
    expect(findings[0]).to.include({ rule: 'DMLStatementInLoop', severity: 'error', analyzerSeverity: 2 });
  });

  it('fails safely when Code Analyzer returns an invalid result', async (): Promise<void> => {
    const runner = new FakeProcessRunner(async (args) => {
      const outputFile = args[args.indexOf('--output-file') + 1];
      if (outputFile !== undefined) {
        await writeFile(outputFile, '{}', 'utf8');
      }
      return '';
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner);
    await expectErrorName(
      service.analyse({ sourceFile: resolve('Example.flow-meta.xml'), rules: [], excludedRules: [] }),
      'FlowCodeAnalyzerFailed'
    );
  });
});

describe('Salesforce Code Analyzer installation consent', (): void => {
  it('installs only after confirmation and verifies the installation', async (): Promise<void> => {
    let inspections = 0;
    const runner = new FakeProcessRunner(async (args) => {
      if (args[0] === 'plugins' && args[1] === '--json') {
        inspections += 1;
        return JSON.stringify(
          inspections === 1
            ? [{ name: CODE_ANALYZER_PLUGIN_FOR_TEST, type: 'jit' }]
            : [{ name: CODE_ANALYZER_PLUGIN_FOR_TEST, type: 'user' }]
        );
      }
      return '';
    });
    const service = new SalesforceCodeAnalyzerFlowService(runner);
    let confirmations = 0;
    await ensureSalesforceCodeAnalyzer(service, {
      canPrompt: true,
      noPrompt: false,
      confirm: async () => {
        confirmations += 1;
        return true;
      },
    });

    expect(confirmations).to.equal(1);
    expect(runner.calls.some((args) => args[0] === 'plugins' && args[1] === 'install')).to.equal(true);
    expect(inspections).to.equal(2);
  });

  it('does not treat an uninstalled JIT placeholder as an installed plugin', async (): Promise<void> => {
    const runner = new FakeProcessRunner(async () =>
      JSON.stringify([{ name: CODE_ANALYZER_PLUGIN_FOR_TEST, alias: 'code-analyzer', type: 'jit' }])
    );
    expect(await new SalesforceCodeAnalyzerFlowService(runner).isInstalled()).to.equal(false);
    expect(runner.calls[0]).to.deep.equal(['plugins', '--json']);
  });
});

describe('Salesforce Code Analyzer non-interactive installation', (): void => {
  it('returns the install command without prompting in non-interactive mode', async (): Promise<void> => {
    const runner = new FakeProcessRunner(async () => '[]');
    const service = new SalesforceCodeAnalyzerFlowService(runner);
    let prompted = false;
    try {
      await ensureSalesforceCodeAnalyzer(service, {
        canPrompt: false,
        noPrompt: false,
        confirm: async () => {
          prompted = true;
          return true;
        },
      });
      expect.fail('Expected FlowCodeAnalyzerUnavailable.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect(error).to.have.property('name', 'FlowCodeAnalyzerUnavailable');
      expect(error)
        .to.have.nested.property('actions[0]')
        .that.contains('sf plugins install @salesforce/plugin-code-analyzer');
    }

    expect(prompted).to.equal(false);
  });
});
