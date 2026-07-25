/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { fileURLToPath } from 'node:url';

import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import type { JsonOutput } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { z } from 'zod';

import type { FlowActivationResult } from '../../../src/types/flow.js';

interface OrgSafetyResult {
  records: Array<{ IsSandbox: boolean }>;
}

const fixtureProject = fileURLToPath(new URL('../../nuts/fixtures/project', import.meta.url));
const targetOrg = process.env.NUT_TARGET_ORG;
const targetOrgSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9._@+-]+$/);
let session: TestSession | undefined;

function requireTargetOrg(): string {
  const result = targetOrgSchema.safeParse(targetOrg);
  if (!result.success) {
    throw new Error('NUT_TARGET_ORG must identify a dedicated scratch org or sandbox.');
  }
  return result.data;
}

function verifyNonProductionOrg(org: string): void {
  const command = `data query --query "SELECT IsSandbox FROM Organization" --target-org ${org} --json`;
  const output = execCmd<OrgSafetyResult>(command, { cli: 'sf', ensureExitCode: 0 }).jsonOutput;
  if (output === undefined || output.result.records[0]?.IsSandbox !== true) {
    throw new Error('NUTs may run only against a Salesforce scratch org or sandbox.');
  }
}

function deployFixture(sourceDirectory: 'v1' | 'v2'): void {
  const command = `project deploy start --target-org ${requireTargetOrg()} --source-dir ${sourceDirectory}`;
  execCmd(command, { cli: 'sf', cwd: fixtureProject, ensureExitCode: 0 });
}

function runActivation(arguments_: string, exitCode = 0): JsonOutput<FlowActivationResult> {
  const command = `flow activate --target-org ${requireTargetOrg()} --api-name Plugin_Test_Flow ${arguments_} --json`;
  const output = execCmd<FlowActivationResult>(command, { ensureExitCode: exitCode }).jsonOutput;
  if (output === undefined) {
    throw new Error('The command did not return JSON output.');
  }
  return output;
}

before(async (): Promise<void> => {
  const org = requireTargetOrg();
  verifyNonProductionOrg(org);
  session = await TestSession.create({ devhubAuthStrategy: 'NONE' });
  deployFixture('v1');
  deployFixture('v2');
});

after(async (): Promise<void> => {
  if (session !== undefined) {
    runActivation('--version 1');
    await session.clean();
  }
});

describe('flow activate read-only NUTs', (): void => {
  it('displays command help', (): void => {
    const output = execCmd('flow activate --help', { ensureExitCode: 0 }).shellOutput.stdout;
    expect(output).to.contain('Activate a Salesforce Flow version');
  });

  it('resolves latest during a dry run without changing the active version', (): void => {
    const dryRun = runActivation('--version latest --dry-run');
    const unchanged = runActivation('--version 1');
    expect(dryRun.result).to.include({ resolvedVersion: 2, changed: false, dryRun: true });
    expect(unchanged.result).to.include({ activeVersion: 1, changed: false });
  });

  it('returns the documented JSON result shape', (): void => {
    const output = runActivation('--version latest --dry-run');
    expect(output.result).to.have.all.keys(
      'apiName',
      'namespace',
      'definitionId',
      'requestedVersion',
      'resolvedVersion',
      'previousActiveVersion',
      'activeVersion',
      'changed',
      'dryRun',
      'targetOrg'
    );
  });
});

describe('flow activate mutation NUTs', (): void => {
  it('activates an explicit version', (): void => {
    const output = runActivation('--version 2');
    expect(output.result).to.include({ resolvedVersion: 2, activeVersion: 2, changed: true });
  });

  it('is idempotent when the version is already active', (): void => {
    const output = runActivation('--version 2');
    expect(output.result).to.include({ activeVersion: 2, changed: false });
  });

  it('resolves latest to the expected version', (): void => {
    const output = runActivation('--version latest');
    expect(output.result).to.include({ resolvedVersion: 2, activeVersion: 2 });
  });
});

describe('flow activate error NUTs', (): void => {
  it('returns FlowDefinitionNotFound for an unknown Flow', (): void => {
    const command = `flow activate --target-org ${requireTargetOrg()} --api-name Plugin_Missing_Flow --json`;
    const output = execCmd(command, { ensureExitCode: 1 }).jsonOutput;
    expect(output).to.have.property('name', 'FlowDefinitionNotFound');
  });

  it('returns FlowVersionNotFound for an unknown version', (): void => {
    const output = runActivation('--version 999', 1);
    expect(output).to.have.property('name', 'FlowVersionNotFound');
  });
});
