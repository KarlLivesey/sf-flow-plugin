/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowExport from '../../../src/commands/flow/export.js';
import { FlowExportService } from '../../../src/services/flow-export-service.js';
import type { FlowExportArtifact } from '../../../src/types/flow-inspection.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$ } from '../../helpers/command-test-context.js';

function exportArtifact(outputFile: string): FlowExportArtifact {
  return {
    content: '<Flow/>',
    result: {
      apiName: 'Source_Flow',
      namespace: null,
      definitionId: '300000000000001',
      requestedVersion: 7,
      resolvedVersion: 7,
      sourceStatus: 'Active',
      exportedStatus: 'Draft',
      format: 'xml',
      outputFile,
      bytes: 7,
      targetOrg: 'admin@example.com',
    },
  };
}

describe('flow export command', (): void => {
  let directory: string;

  afterEach(async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes the returned deployable metadata to the requested file', async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'sf-flow-export-'));
    const outputFile = join(directory, 'flows', 'Source_Flow.flow-meta.xml');
    const flags = {
      'api-name': 'Source_Flow',
      'target-org': createCommandOrg({} as Connection),
      'flow-version': 7,
      format: 'xml' as const,
      status: 'draft' as const,
      'output-file': outputFile,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowExport.prototype, 'parseFlags').resolves(flags);
    const exportFlow = $$.SANDBOX.stub(FlowExportService.prototype, 'export').resolves(exportArtifact(outputFile));
    const result = await FlowExport.run(['--json']);
    expect(exportFlow.firstCall.args[0]).to.include({ version: 7, status: 'draft', outputFile });
    expect(await readFile(outputFile, 'utf8')).to.equal('<Flow/>');
    expect(result.outputFile).to.equal(outputFile);
  });
});
