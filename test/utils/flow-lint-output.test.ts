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

import type { FlowLintFinding, FlowLintResult } from '../../src/types/flow-lint.js';
import { applyFlowLintBaseline, formatFlowLintSarif } from '../../src/utils/flow-lint-output.js';

const existing: FlowLintFinding = {
  rule: 'hard-coded-id',
  severity: 'warning',
  message: 'An ID is hard-coded.',
  element: null,
  path: 'formulas[0].expression',
};

const added: FlowLintFinding = {
  rule: 'unused-resource',
  severity: 'warning',
  message: 'A resource is unused.',
  element: 'Unused',
  path: null,
};

function lintResult(): FlowLintResult {
  return {
    apiName: 'Root_Flow',
    namespace: null,
    definitionId: '300000000000001',
    requestedVersion: 'latest',
    resolvedVersion: 1,
    status: 'Draft',
    findings: [existing, added],
    newFindings: [existing, added],
    baselineFindings: [],
    errors: 0,
    warnings: 2,
    newErrors: 0,
    newWarnings: 2,
    targetOrg: 'admin@example.com',
  };
}

describe('Flow lint output', (): void => {
  it('separates baseline findings from new findings and marks SARIF state', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-lint-'));
    const baseline = join(directory, 'baseline.json');
    try {
      await writeFile(baseline, JSON.stringify({ findings: [existing] }), 'utf8');
      const result = await applyFlowLintBaseline(lintResult(), baseline);
      const sarif = JSON.parse(formatFlowLintSarif(result)) as {
        runs: Array<{ results: Array<{ baselineState: string }> }>;
      };
      expect(result.baselineFindings).to.deep.equal([existing]);
      expect(result.newFindings).to.deep.equal([added]);
      expect(sarif.runs[0]?.results.map((item) => item.baselineState)).to.deep.equal(['unchanged', 'new']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
