/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { checkSourceDirectory } from '../../src/services/flow-source-directory-runner.js';
import type { SalesforceCodeAnalyzerFlowService } from '../../src/services/salesforce-code-analyzer-flow-service.js';
import type { FlowCheckKind } from '../../src/types/flow-check.js';

const FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>Local Flow</label>
  <processType>AutoLaunchedFlow</processType>
  <status>Draft</status>
</Flow>`;

function checksThatAddSource(directory: string, selected: FlowCheckKind[]): FlowCheckKind[] {
  const checks = [...selected];
  const includes = checks.includes.bind(checks);
  checks.includes = (value): boolean => {
    writeFileSync(join(directory, 'Added.flow-meta.xml'), FLOW_XML, 'utf8');
    return includes(value);
  };
  return checks;
}

describe('Flow source directory runner snapshot verification', (): void => {
  for (const selected of [['metrics'], ['subflows'], ['metrics', 'subflows']] as FlowCheckKind[][]) {
    it(`rejects membership changes for ${selected.join(' and ')} checks`, async (): Promise<void> => {
      const directory = await mkdtemp(join(tmpdir(), 'sf-flow-directory-runner-'));
      try {
        await writeFile(join(directory, 'Original.flow-meta.xml'), FLOW_XML, 'utf8');
        const error = await checkSourceDirectory({
          sourceDirectory: directory,
          checks: checksThatAddSource(directory, selected),
          excludedChecks: [],
          recursive: false,
          maxDepth: 0,
          analyzer: {} as SalesforceCodeAnalyzerFlowService,
          progress: (): void => undefined,
          rules: [],
          excludedRules: [],
        }).catch((caught: unknown) => caught);

        expect(error).to.have.property('name', 'FlowSourceInvalid');
        expect(error).to.have.property('message').that.includes('changed while it was being analysed');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});
