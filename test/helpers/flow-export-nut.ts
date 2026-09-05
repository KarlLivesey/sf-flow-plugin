/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execCmd } from '@salesforce/cli-plugins-testkit';

import type { FlowExportResult } from '../../src/types/flow-inspection.js';

function exportFlow(org: string, outputFile: string): FlowExportResult {
  const command =
    `flow export --target-org ${org} --api-name Plugin_Test_Flow --flow-version active ` +
    `--output-file ${outputFile} --json`;
  const output = execCmd<FlowExportResult>(command, { ensureExitCode: 0 }).jsonOutput;
  if (output === undefined) {
    throw new Error('The flow export command did not return JSON output.');
  }
  return output.result;
}

function validateDeployment(org: string, projectDirectory: string, outputFile: string): void {
  execCmd(`project deploy start --dry-run --target-org ${org} --source-dir ${outputFile} --json`, {
    cli: 'sf',
    cwd: projectDirectory,
    ensureExitCode: 0,
  });
}

export async function verifyExportDeployment(org: string): Promise<FlowExportResult> {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-plugin-export-'));
  const outputFile = join(projectDirectory, 'force-app/main/default/flows/Plugin_Test_Flow.flow-meta.xml');
  try {
    await writeFile(
      join(projectDirectory, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '65.0' })
    );
    const result = exportFlow(org, outputFile);
    validateDeployment(org, projectDirectory, outputFile);
    return result;
  } finally {
    await rm(projectDirectory, { recursive: true, force: true });
  }
}
