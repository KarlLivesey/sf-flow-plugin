/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { resolve } from 'node:path';

import { expect } from 'chai';

import {
  checkFlowSource,
  describeFlowSource,
  graphFlowSource,
  lintFlowSource,
} from '../../src/services/flow-source-analysis-service.js';
import { loadFlowSource } from '../../src/services/flow-source-service.js';
import type { FlowGraphRenderRequest } from '../../src/types/flow-inspection.js';

const fixture = resolve('test/nuts/fixtures/project/v3/main/default/flows/Plugin_Test_Flow.flow-meta.xml');

const graphRequest: FlowGraphRenderRequest = {
  format: 'mermaid',
  includeVariables: true,
  includeFormulas: false,
  direction: 'auto',
  layout: ['auto'],
  curve: 'auto',
  elk: {
    nodePlacement: 'auto',
    modelOrder: 'auto',
    cycleBreaking: 'auto',
    mergeEdges: false,
    forceNodeOrder: false,
  },
  nodeSpacing: 50,
  rankSpacing: 70,
  legend: false,
  labelWidth: 32,
  style: { colors: {}, fontFamily: 'Arial', fontSize: 14 },
};

describe('local Flow source analysis', (): void => {
  it('describes selected sections with an explicit local-source contract', async (): Promise<void> => {
    const source = await loadFlowSource(fixture);
    const result = describeFlowSource(source, ['outputs', 'elements']);
    expect(result).to.include({
      apiName: 'Plugin_Test_Flow',
      requestedVersion: null,
      resolvedVersion: null,
      recursive: false,
      targetOrg: null,
      sourceFile: fixture,
    });
    expect(result.sections).to.deep.equal(['outputs', 'elements']);
    expect(result.flows[0]?.variables.map((variable) => variable.name)).to.deep.equal(['Result']);
    expect(result.flows[0]?.formulas).to.deep.equal([]);
  });

  it('runs only static lint rules and ignores Flow global names that resemble IDs', async (): Promise<void> => {
    const source = await loadFlowSource(fixture);
    const result = lintFlowSource(source, { rules: [], excludedRules: [] });
    expect(result.targetOrg).to.equal(null);
    expect(result.sourceFile).to.equal(fixture);
    expect(result.findings.some((finding) => finding.message.includes('CurrentDateTime'))).to.equal(false);
    expect(() => lintFlowSource(source, { rules: ['missing-subflow'], excludedRules: [] }))
      .to.throw()
      .with.property('name', 'FlowLintFailed');
  });
});

describe('local Flow source check and graph analysis', (): void => {
  it('defaults checks to lint and permits local static metrics', async (): Promise<void> => {
    const source = await loadFlowSource(fixture);
    const defaultResult = checkFlowSource(source, { requested: [], excluded: [] });
    expect(defaultResult.checks).to.deep.equal(['lint']);
    expect(defaultResult.flows[0]?.metrics).to.equal(null);

    const metricsResult = checkFlowSource(source, { requested: ['metrics'], excluded: [] });
    expect(metricsResult.checks).to.deep.equal(['metrics']);
    expect(metricsResult.flows[0]?.metrics?.flows[0]).to.include({
      apiName: 'Plugin_Test_Flow',
      version: null,
    });
    expect(() => checkFlowSource(source, { requested: ['dependencies'], excluded: [] }))
      .to.throw()
      .with.property('name', 'FlowCheckFailed');
  });

  it('renders a local graph without manufacturing an org or version identity', async (): Promise<void> => {
    const source = await loadFlowSource(fixture);
    const result = graphFlowSource(source, graphRequest);
    expect(result).to.include({
      targetOrg: null,
      requestedVersion: null,
      resolvedVersion: null,
      sourceFile: fixture,
    });
    expect(result.graph).to.include('Plugin_Test_Flow local source');
    expect(result.graph).not.to.include('vnull');
  });
});
