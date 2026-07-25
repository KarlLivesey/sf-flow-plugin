/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { fileURLToPath } from 'node:url';

import { execCmd } from '@salesforce/cli-plugins-testkit';
import type { JsonOutput } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { z } from 'zod';

import type {
  FlowActivationResult,
  FlowAuditResult,
  FlowDeactivationResult,
  FlowPruneResult,
  FlowVersionsResult,
} from '../../../src/types/flow.js';

interface OrgSafetyResult {
  records: Array<{ IsSandbox: boolean; OrganizationType: string }>;
}

interface FlowDefinitionLookupResult {
  records: Array<{ Id: string; ActiveVersionId: string | null }>;
}

interface FlowVersionLookupResult {
  records: Array<{ Id: string }>;
}

const fixtureProject = fileURLToPath(new URL('../../nuts/fixtures/project', import.meta.url));
const targetOrg = process.env.NUT_TARGET_ORG;
const targetOrgSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9._@+-]+$/);
let fixtureDeployed = false;

function requireTargetOrg(): string {
  const result = targetOrgSchema.safeParse(targetOrg);
  if (!result.success) {
    throw new Error('NUT_TARGET_ORG must identify a dedicated scratch org, sandbox, or Developer Edition org.');
  }
  return result.data;
}

function verifyNonProductionOrg(org: string): void {
  const command =
    'data query --query "SELECT IsSandbox, OrganizationType FROM Organization" ' + `--target-org ${org} --json`;
  const output = execCmd<OrgSafetyResult>(command, { cli: 'sf', ensureExitCode: 0 }).jsonOutput;
  const organization = output?.result.records[0];
  if (organization?.IsSandbox !== true && organization?.OrganizationType !== 'Developer Edition') {
    throw new Error('NUTs may run only against a Salesforce scratch org, sandbox, or Developer Edition org.');
  }
}

function deployFixture(sourceDirectory: 'v1' | 'v2' | 'v3'): void {
  const command = `project deploy start --target-org ${requireTargetOrg()} --source-dir ${sourceDirectory}`;
  execCmd(command, { cli: 'sf', cwd: fixtureProject, ensureExitCode: 0 });
}

function findFixture(org: string): FlowDefinitionLookupResult['records'][number] | undefined {
  const query =
    'SELECT Id, ActiveVersionId FROM FlowDefinition ' +
    "WHERE DeveloperName = 'Plugin_Test_Flow' AND NamespacePrefix = null";
  const lookup = execCmd<FlowDefinitionLookupResult>(
    `data query --use-tooling-api --query "${query}" --target-org ${org} --json`,
    { cli: 'sf', ensureExitCode: 0 }
  ).jsonOutput;
  if (lookup === undefined) {
    throw new Error('The fixture lookup did not return JSON output.');
  }
  return lookup.result.records[0];
}

function deactivateFixture(org: string, definitionId: string): void {
  const endpoint = `/services/data/v65.0/tooling/sobjects/FlowDefinition/${definitionId}`;
  const body = '\'{"Metadata":{"activeVersionNumber":0}}\'';
  execCmd(`api request rest ${endpoint} --target-org ${org} --method PATCH --body ${body}`, {
    cli: 'sf',
    ensureExitCode: 0,
  });
}

function deleteFixtureVersions(org: string, definitionId: string): void {
  const query = `SELECT Id FROM Flow WHERE DefinitionId = '${definitionId}'`;
  const lookup = execCmd<FlowVersionLookupResult>(
    `data query --use-tooling-api --query "${query}" --target-org ${org} --json`,
    { cli: 'sf', ensureExitCode: 0 }
  ).jsonOutput;
  if (lookup === undefined) {
    throw new Error('The fixture version lookup did not return JSON output.');
  }
  for (const version of lookup.result.records) {
    execCmd(
      `data delete record --use-tooling-api --sobject Flow --record-id ${version.Id} ` + `--target-org ${org} --json`,
      { cli: 'sf', ensureExitCode: 0 }
    );
  }
}

function deleteFixtureIfPresent(org: string): void {
  const fixture = findFixture(org);
  if (fixture === undefined) {
    return;
  }
  if (fixture.ActiveVersionId !== null) {
    deactivateFixture(org, fixture.Id);
  }
  deleteFixtureVersions(org, fixture.Id);
  if (findFixture(org) !== undefined) {
    throw new Error('Salesforce retained the fixture FlowDefinition after all versions were deleted.');
  }
}

function runActivation(arguments_: string, exitCode = 0): JsonOutput<FlowActivationResult> {
  const command = `flow activate --target-org ${requireTargetOrg()} --api-name Plugin_Test_Flow ${arguments_} --json`;
  const output = execCmd<FlowActivationResult>(command, { ensureExitCode: exitCode }).jsonOutput;
  if (output === undefined) {
    throw new Error('The command did not return JSON output.');
  }
  return output;
}

function runFlowCommand<TResult>(commandName: string, arguments_: string): JsonOutput<TResult> {
  const command = `flow ${commandName} --target-org ${requireTargetOrg()} ${arguments_} --json`;
  const output = execCmd<TResult>(command, { ensureExitCode: 0 }).jsonOutput;
  if (output === undefined) {
    throw new Error(`The flow ${commandName} command did not return JSON output.`);
  }
  return output;
}

before((): void => {
  const org = requireTargetOrg();
  verifyNonProductionOrg(org);
  deleteFixtureIfPresent(org);
  deployFixture('v1');
  fixtureDeployed = true;
  deployFixture('v2');
});

after((): void => {
  if (fixtureDeployed) {
    deleteFixtureIfPresent(requireTargetOrg());
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

describe('Flow lifecycle command NUTs', (): void => {
  it('lists active and latest versions', (): void => {
    const output = runFlowCommand<FlowVersionsResult>('versions', '--api-name Plugin_Test_Flow');
    expect(output.result.versions.map((version) => version.versionNumber)).to.deep.equal([1, 2]);
    expect(output.result.versions.find((version) => version.active)?.versionNumber).to.equal(2);
  });

  it('audits the fixture Flow', (): void => {
    const output = runFlowCommand<FlowAuditResult>('audit', '');
    const fixture = output.result.flows.find((flow) => flow.apiName === 'Plugin_Test_Flow');
    expect(fixture).to.not.equal(undefined);
  });

  it('deactivates and verifies the fixture Flow', (): void => {
    const output = runFlowCommand<FlowDeactivationResult>('deactivate', '--api-name Plugin_Test_Flow');
    expect(output.result).to.include({ previousActiveVersion: 2, activeVersion: null, changed: true });
  });

  it('prunes an old inactive version while protecting active and latest', (): void => {
    runActivation('--version 1');
    deployFixture('v3');
    const preview = runFlowCommand<FlowPruneResult>('prune', '--api-name Plugin_Test_Flow --keep 0');
    expect(preview.result.plannedDeletions.map((version) => version.versionNumber)).to.deep.equal([2]);
    const output = runFlowCommand<FlowPruneResult>('prune', '--api-name Plugin_Test_Flow --keep 0 --no-dry-run');
    expect(output.result.deletedVersions.map((version) => version.versionNumber)).to.deep.equal([2]);
    expect(output.result.protectedVersions.map((version) => version.versionNumber)).to.have.members([1, 3]);
  });
});
