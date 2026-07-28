/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

import { expect } from 'chai';

import FlowCheck from '../../../src/commands/flow/check.js';
import FlowCompare from '../../../src/commands/flow/compare.js';
import FlowDescribe from '../../../src/commands/flow/describe.js';
import FlowGraph from '../../../src/commands/flow/graph.js';
import FlowLint from '../../../src/commands/flow/lint.js';
import { FlowCheckService } from '../../../src/services/flow-check-service.js';
import { FlowDescribeService } from '../../../src/services/flow-describe-service.js';
import { FlowGraphService } from '../../../src/services/flow-graph-service.js';
import { FlowLintService } from '../../../src/services/flow-lint-service.js';
import { SalesforceCodeAnalyzerFlowService } from '../../../src/services/salesforce-code-analyzer-flow-service.js';
import { validateFlowSourceFlags } from '../../../src/utils/flow-source-command.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';
import { expectErrorName } from '../../helpers/fake-flow-gateway.js';

const fixture = resolve('test/nuts/fixtures/project/v3/main/default/flows/Plugin_Test_Flow.flow-meta.xml');

describe('local Flow source commands', (): void => {
  it('runs lint without calling an org-backed service', async (): Promise<void> => {
    const orgLint = $$.SANDBOX.stub(FlowLintService.prototype, 'lint');
    $$.SANDBOX.stub(SalesforceCodeAnalyzerFlowService.prototype, 'isInstalled').resolves(true);
    $$.SANDBOX.stub(SalesforceCodeAnalyzerFlowService.prototype, 'analyse').resolves([]);
    const result = await FlowLint.run(['--source-file', fixture, '--json']);
    expect(orgLint.called).to.equal(false);
    expect(result).to.include({
      apiName: 'Plugin_Test_Flow',
      definitionId: null,
      requestedVersion: null,
      resolvedVersion: null,
      targetOrg: null,
      sourceFile: fixture,
    });
  });

  it('reports the Code Analyzer installation command in JSON mode instead of prompting', async (): Promise<void> => {
    $$.SANDBOX.stub(SalesforceCodeAnalyzerFlowService.prototype, 'isInstalled').resolves(false);
    await expectErrorName(
      FlowLint.run(['--source-file', fixture, '--no-prompt', '--json']),
      'FlowCodeAnalyzerUnavailable'
    );
  });

  it('rejects a source file changed while Code Analyzer is running', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-source-analyzer-change-'));
    const sourceFile = join(directory, 'Changed_Flow.flow-meta.xml');
    try {
      await writeFile(sourceFile, await readFile(fixture));
      $$.SANDBOX.stub(SalesforceCodeAnalyzerFlowService.prototype, 'isInstalled').resolves(true);
      $$.SANDBOX.stub(SalesforceCodeAnalyzerFlowService.prototype, 'analyse').callsFake(async () => {
        await writeFile(sourceFile, (await readFile(sourceFile, 'utf8')).replace('Plugin Test Flow', 'Changed Flow'));
        return [];
      });
      await expectErrorName(FlowLint.run(['--source-file', sourceFile, '--json']), 'FlowSourceInvalid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs check without calling an org-backed service', async (): Promise<void> => {
    const orgCheck = $$.SANDBOX.stub(FlowCheckService.prototype, 'check');
    const result = await FlowCheck.run(['--source-file', fixture, '--only', 'metrics', '--json']);
    expect(orgCheck.called).to.equal(false);
    expect(result.checks).to.deep.equal(['metrics']);
    expect(result.targetOrg).to.equal(null);
  });

  it('compares two local Flow files without resolving an org', async (): Promise<void> => {
    const result = await FlowCompare.run(['--from-file', fixture, '--to-file', fixture, '--json']);
    expect(result).to.include({
      apiName: 'Plugin_Test_Flow',
      fromDefinitionId: null,
      toDefinitionId: null,
      fromVersion: null,
      toVersion: null,
      targetOrg: null,
      different: false,
    });
    expect(result.fromSourceFile).to.equal(fixture);
    expect(result.toSourceFile).to.equal(fixture);
  });
});

describe('local Flow source inspection commands', (): void => {
  it('runs describe without calling an org-backed service', async (): Promise<void> => {
    const orgDescribe = $$.SANDBOX.stub(FlowDescribeService.prototype, 'describe');
    const result = await FlowDescribe.run(['--source-file', fixture, '--only', 'outputs', '--json']);
    expect(orgDescribe.called).to.equal(false);
    expect(result.sections).to.deep.equal(['outputs']);
    expect(result.flows[0]?.versionNumber).to.equal(null);
  });

  it('runs graph without calling an org-backed service', async (): Promise<void> => {
    const orgGraph = $$.SANDBOX.stub(FlowGraphService.prototype, 'graph');
    const result = await FlowGraph.run(['--source-file', fixture, '--include-variables', '--json']);
    expect(orgGraph.called).to.equal(false);
    expect(result.graph).to.include('Plugin_Test_Flow local source');
    expect(result.targetOrg).to.equal(null);
  });

  it('rejects org and recursive flags in source-file mode', async (): Promise<void> => {
    await expectErrorName(FlowDescribe.run(['--source-file', fixture, '--recursive', '--json']), 'FlowSourceInvalid');
    await expectErrorName(
      FlowLint.run(['--source-file', fixture, '--target-org', 'example', '--json']),
      'FlowSourceInvalid'
    );
  });

  it('rejects unsupported source flags appended by flags-dir preparse expansion', (): void => {
    expect(() => {
      validateFlowSourceFlags(
        ['--source-file', fixture, '--flags-dir', '/tmp/flags', '--target-org', 'from-flags-dir'],
        ['target-org']
      );
    })
      .to.throw()
      .with.property('name', 'FlowSourceInvalid');
  });
});
