/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { lintFlowSourceDirectory } from '../../src/services/flow-source-analysis-service.js';
import { loadFlowSourceDirectory } from '../../src/services/flow-source-directory-service.js';
import { applyFlowLintDirectoryBaseline } from '../../src/utils/flow-lint-directory-baseline.js';

describe('directory lint baselines', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow baseline '));
    const xml =
      '<Flow xmlns="http://soap.sforce.com/2006/04/metadata"><label>Root</label><processType>AutoLaunchedFlow</processType><status>Draft</status></Flow>';
    await writeFile(join(directory, 'Root.flow-meta.xml'), xml);
    await writeFile(join(directory, 'managed__Root.flow-meta.xml'), xml);
  });
  afterEach(async (): Promise<void> => rm(directory, { recursive: true, force: true }));

  it('consumes status-1 directory JSON without suppressing another namespace', async (): Promise<void> => {
    const result = lintFlowSourceDirectory(await loadFlowSourceDirectory(directory), []);
    const finding = {
      fingerprint: 'a'.repeat(64),
      rule: 'Example',
      severity: 'warning' as const,
      message: 'Finding',
      element: null,
      path: null,
    };
    result.flows = result.flows.map((flow) => ({ ...flow, findings: [finding], newFindings: [finding] }));
    const baseline = join(directory, 'baseline.json');
    await writeFile(
      baseline,
      JSON.stringify({
        status: 1,
        warnings: [],
        result: { sourceDirectory: '/another/checkout', flows: result.flows.filter((flow) => flow.namespace === null) },
      })
    );
    const actual = await applyFlowLintDirectoryBaseline(result, baseline);
    expect(actual.baselineFindings).to.have.length(1);
    expect(actual.newFindings).to.have.length(1);
    expect(actual.flows.find((flow) => flow.namespace === 'managed')?.newWarnings).to.equal(1);
  });

  it('rejects duplicate identities and unscoped findings', async (): Promise<void> => {
    const result = lintFlowSourceDirectory(await loadFlowSourceDirectory(directory), []);

    await Promise.all(
      [{ findings: [] }, { ...result, flows: [result.flows[0], result.flows[0]] }].map(async (document, index) => {
        const file = join(directory, `invalid-${index}.json`);
        await writeFile(file, JSON.stringify(document));
        const error: unknown = await applyFlowLintDirectoryBaseline(result, file).catch((caught: unknown) => caught);
        expect(error).to.have.property('name', 'FlowLintFailed');
      })
    );
  });
});
