/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Org } from '@salesforce/core';
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowActivate, { parseFlowVersionSelector } from '../../../src/commands/flow/activate.js';
import { FlowDefinitionService } from '../../../src/services/flow-definition-service.js';
import type { FlowActivationResult } from '../../../src/types/flow.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';

const result: FlowActivationResult = {
  apiName: 'Order_Processing',
  namespace: 'example',
  definitionId: '300000000000001',
  requestedVersion: 'latest',
  resolvedVersion: 2,
  previousActiveVersion: 1,
  activeVersion: 2,
  changed: true,
  dryRun: false,
  targetOrg: 'admin@example.com',
};

function createOrg(connection: Connection): Org {
  return {
    getConnection: (_apiVersion?: string): Connection => {
      void _apiVersion;
      return connection;
    },
    getUsername: (): string => 'admin@example.com',
  } as unknown as Org;
}

async function expectError(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected ${name}.`);
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).name).to.equal(name);
  }
}

describe('flow activate flags', (): void => {
  it('provides help and examples', (): void => {
    expect(FlowActivate.summary).to.contain('Activate');
    expect(FlowActivate.examples).to.have.length.greaterThan(0);
  });

  it('requires the Flow API name', (): void => {
    expect(FlowActivate.flags['api-name'].required).to.equal(true);
    expect(FlowActivate.flags['api-name'].char).to.equal('n');
  });

  it('uses the standard Salesforce default-org resolver when the flag is omitted', async (): Promise<void> => {
    const org = createOrg({} as Connection);
    const create = $$.SANDBOX.stub(Org, 'create').resolves(org);
    const defaultResolver = FlowActivate.flags['target-org'].default;
    expect(FlowActivate.flags['target-org'].required).to.equal(false);
    if (typeof defaultResolver !== 'function') {
      expect.fail('Expected the target-org flag to provide a default resolver.');
    }
    const resolved = await defaultResolver({} as never);
    expect(resolved).to.equal(org);
    expect(create.calledWith({ aliasOrUsername: undefined })).to.equal(true);
    expect(FlowActivate.flags['target-org'].char).to.equal('o');
  });

  it('defaults the version to latest', (): void => {
    expect(FlowActivate.flags['flow-version'].default).to.equal('latest');
  });
});

describe('parseFlowVersionSelector', (): void => {
  it('accepts latest', (): void => {
    expect(parseFlowVersionSelector('latest')).to.equal('latest');
  });

  it('accepts a positive integer', (): void => {
    expect(parseFlowVersionSelector('7')).to.equal(7);
  });

  for (const invalid of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
    it(`rejects ${invalid}`, (): void => {
      expect(() => parseFlowVersionSelector(invalid))
        .to.throw()
        .with.property('name', 'FlowVersionInvalid');
    });
  }
});

describe('flow activate command execution', (): void => {
  it('passes namespace and dry-run to the service and returns its result', async (): Promise<void> => {
    const connection = {} as Connection;
    const getConnection = $$.SANDBOX.stub().withArgs('65.0').returns(connection);
    const targetOrg = { getConnection, getUsername: (): string => 'admin@example.com' } as unknown as Org;
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': targetOrg,
      'flow-version': 'latest' as const,
      'if-active-version': 1,
      'if-latest-version': 2,
      namespace: 'example',
      'api-version': '65.0',
      'dry-run': true,
    };
    $$.SANDBOX.stub(FlowActivate.prototype, 'parseFlags').resolves(flags);
    const activate = $$.SANDBOX.stub(FlowDefinitionService.prototype, 'activate').resolves(result);
    const actual = await FlowActivate.run([]);
    expect(activate.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      requestedVersion: 'latest',
      expectedActiveVersion: 1,
      expectedLatestVersion: 2,
      namespace: 'example',
      apiVersion: '65.0',
      dryRun: true,
    });
    expect(getConnection.calledOnce).to.equal(true);
    expect(actual).to.equal(result);
  });

  it('writes concise human-readable output', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createOrg({} as Connection),
      'flow-version': 'latest' as const,
      'if-active-version': undefined,
      'if-latest-version': undefined,
      namespace: undefined,
      'api-version': undefined,
      'dry-run': false,
    };
    $$.SANDBOX.stub(FlowActivate.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowDefinitionService.prototype, 'activate').resolves({ ...result, namespace: null });
    await FlowActivate.run([]);
    expect(commandUx.log.firstCall.args[0]).to.contain('Activated Flow Order_Processing version 2');
  });
});

describe('flow activate command output and errors', (): void => {
  it('returns the exact service result in JSON mode', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createOrg({} as Connection),
      'flow-version': 'latest' as const,
      'if-active-version': undefined,
      'if-latest-version': undefined,
      namespace: undefined,
      'api-version': undefined,
      'dry-run': false,
    };
    $$.SANDBOX.stub(FlowActivate.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowDefinitionService.prototype, 'activate').resolves(result);
    const actual = await FlowActivate.run(['--json']);
    expect(actual).to.deep.equal(result);
    expect(commandUx.log.called).to.equal(false);
  });

  it('fails clearly when no flag or default target org is available', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': undefined,
      'flow-version': 'latest' as const,
      'if-active-version': undefined,
      'if-latest-version': undefined,
      namespace: undefined,
      'api-version': undefined,
      'dry-run': false,
    };
    $$.SANDBOX.stub(FlowActivate.prototype, 'parseFlags').resolves(flags);
    await expectError(FlowActivate.run([]), 'TargetOrgNotFound');
  });
});
