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
import { createFlowLintFingerprint } from '../../src/utils/flow-lint-fingerprint.js';
import { applyFlowLintBaseline, formatFlowLintSarif } from '../../src/utils/flow-lint-output.js';

const existing: FlowLintFinding = {
  fingerprint: 'a'.repeat(64),
  rule: 'hard-coded-id',
  severity: 'warning',
  message: 'An ID is hard-coded.',
  element: null,
  path: 'formulas[0].expression',
};

const added: FlowLintFinding = {
  fingerprint: 'b'.repeat(64),
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

function withoutFingerprint(finding: FlowLintFinding): Omit<FlowLintFinding, 'fingerprint'> {
  const { fingerprint: _fingerprint, ...legacy } = finding;
  void _fingerprint;
  return legacy;
}

interface SarifOutput {
  runs: Array<{
    results: Array<{
      baselineState: string;
      locations?: Array<{ logicalLocations: Array<{ name: string }>; physicalLocation?: unknown }>;
      partialFingerprints: Record<string, string>;
    }>;
  }>;
}

function assertSarifOutput(result: FlowLintResult): void {
  const sarif = JSON.parse(formatFlowLintSarif(result)) as SarifOutput;
  expect(result.baselineFindings).to.deep.equal([existing]);
  expect(result.newFindings).to.deep.equal([added]);
  expect(sarif.runs[0]?.results.map((item) => item.baselineState)).to.deep.equal(['unchanged', 'new']);
  expect(sarif.runs[0]?.results[0]?.locations?.[0]?.logicalLocations[0]?.name).to.equal('formulas[0].expression');
  expect(sarif.runs[0]?.results[0]?.locations?.[0]?.physicalLocation).to.equal(undefined);
  expect(sarif.runs[0]?.results[0]?.partialFingerprints['sf-flow-plugin/v1']).to.equal(existing.fingerprint);
}

describe('Flow lint output', (): void => {
  it('separates baseline findings from new findings and marks SARIF state', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-lint-'));
    const baseline = join(directory, 'baseline.json');
    try {
      await writeFile(
        baseline,
        JSON.stringify({ findings: [{ ...existing, message: 'Previous harmless wording.' }] }),
        'utf8'
      );
      const result = await applyFlowLintBaseline(lintResult(), baseline);
      assertSarifOutput(result);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('matches fingerprintless DML-loop findings by their legacy message when the loop label differs', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-lint-legacy-'));
    const baseline = join(directory, 'baseline.json');
    const finding: FlowLintFinding = {
      fingerprint: createFlowLintFingerprint({
        rule: 'dml-inside-loop',
        element: 'Create_Account',
        evidence: ['Process_Accounts_Loop'],
      }),
      rule: 'dml-inside-loop',
      severity: 'warning',
      message: 'Record Create "Create Account" runs inside loop "Process Accounts".',
      element: 'Create_Account',
      path: null,
    };
    try {
      await writeFile(baseline, JSON.stringify({ findings: [withoutFingerprint(finding)] }), 'utf8');
      const result = await applyFlowLintBaseline({ ...lintResult(), findings: [finding] }, baseline);
      expect(result.baselineFindings).to.deep.equal([finding]);
      expect(result.newFindings).to.deep.equal([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
