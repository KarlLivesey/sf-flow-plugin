/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { access, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { expect } from 'chai';
import sinon from 'sinon';

import { FlowOrgAnalyzerService } from '../../src/services/flow-org-analyzer-service.js';
import { SalesforceCodeAnalyzerFlowService } from '../../src/services/salesforce-code-analyzer-flow-service.js';
import { nestedFlowGateway } from '../helpers/flow-inspection-fixtures.js';

async function verifyOrgAnalysis(sandbox: sinon.SinonSandbox): Promise<void> {
  const analyzer = new SalesforceCodeAnalyzerFlowService();
  let sourceFile = '';
  sandbox.stub(analyzer, 'analyse').callsFake(async (request) => {
    sourceFile = request.sourceFile;
    expect(basename(sourceFile)).to.equal('Flow_A.flow-meta.xml');
    expect(await readFile(sourceFile, 'utf8')).to.include('<status>Active</status>');
    expect(request.rules).to.deep.equal(['FlowElementNamingConvention']);
    return [
      {
        fingerprint: 'a'.repeat(64),
        rule: 'FlowElementNamingConvention',
        message: 'Example',
        severity: 'warning',
        path: 'line 1:1',
        element: null,
      },
    ];
  });
  const result = await new FlowOrgAnalyzerService(nestedFlowGateway(), analyzer).lint(
    {
      apiName: 'Flow_A',
      targetOrg: 'test',
      version: 'active',
      rules: ['FlowElementNamingConvention'],
      excludedRules: [],
    },
    (): void => undefined
  );
  expect(result).to.include({ apiName: 'Flow_A', resolvedVersion: 1, status: 'Active', warnings: 1 });
  expect(result).not.to.have.property('sourceFile');
  const error: unknown = await access(sourceFile).catch((caught: unknown) => caught);
  expect(error).to.have.property('code', 'ENOENT');
}

async function verifyAnalyzerFailure(sandbox: sinon.SinonSandbox): Promise<void> {
  const analyzer = new SalesforceCodeAnalyzerFlowService();
  let sourceFile = '';
  sandbox.stub(analyzer, 'analyse').callsFake(async (request) => {
    sourceFile = request.sourceFile;
    throw new Error('analyser failed');
  });
  const error: unknown = await new FlowOrgAnalyzerService(nestedFlowGateway(), analyzer)
    .lint(
      {
        apiName: 'Flow_A',
        targetOrg: 'test',
        version: 'latest',
        rules: [],
        excludedRules: [],
      },
      (): void => undefined
    )
    .catch((caught: unknown) => caught);
  expect(error).to.have.property('message', 'analyser failed');
  expect(await access(sourceFile).catch((caught: unknown) => caught)).to.have.property('code', 'ENOENT');
}

describe('org Flow Scanner', (): void => {
  const sandbox = sinon.createSandbox();
  afterEach((): void => {
    sandbox.restore();
  });

  it('analyses the requested version, preserves status and removes temporary source', async (): Promise<void> =>
    verifyOrgAnalysis(sandbox));

  it('cleans temporary Flow metadata when the analyser fails', async (): Promise<void> =>
    verifyAnalyzerFailure(sandbox));
});
