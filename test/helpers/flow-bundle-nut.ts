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
import type { JsonOutput } from '@salesforce/cli-plugins-testkit';

import type { FlowBundleResult } from '../../src/types/flow-bundle.js';

function requireResult(output: JsonOutput<FlowBundleResult> | undefined): FlowBundleResult {
  if (output === undefined) {
    throw new Error('The flow bundle command did not return JSON output.');
  }
  return output.result;
}

export async function verifyBundleDeployment(org: string): Promise<FlowBundleResult> {
  const project = await mkdtemp(join(tmpdir(), 'sf-flow-plugin-bundle-'));
  const outputDirectory = join(project, 'force-app/main/default');
  try {
    await writeFile(
      join(project, 'sfdx-project.json'),
      JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '65.0' })
    );
    const command =
      `flow bundle --target-org ${org} --api-name Plugin_Test_Flow ` +
      `--flow-version active --output-dir ${outputDirectory} --json`;
    const output = execCmd<FlowBundleResult>(command, { ensureExitCode: 0 }).jsonOutput;
    execCmd(`project deploy start --dry-run --target-org ${org} --source-dir ${join(outputDirectory, 'flows')}`, {
      cli: 'sf',
      cwd: project,
      ensureExitCode: 0,
    });
    return requireResult(output);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}
