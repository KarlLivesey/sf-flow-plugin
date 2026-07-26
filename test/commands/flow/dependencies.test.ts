/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import FlowDependencies from '../../../src/commands/flow/dependencies.js';
import type { DependenciesFlagValues } from '../../../src/commands/flow/dependencies.js';
import { FlowDependenciesService } from '../../../src/services/flow-dependencies-service.js';
import type { FlowDependenciesResult } from '../../../src/types/flow-analysis.js';
import { createCommandOrg } from '../../helpers/command-org.js';
import { commandTestContext as $$, commandUx } from '../../helpers/command-test-context.js';

const result: FlowDependenciesResult = {
  apiName: 'Order_Processing',
  namespace: null,
  definitionId: '300000000000001',
  direction: 'both',
  recursive: false,
  maxDepth: 10,
  types: [],
  excludeTypes: [],
  definitionsScanned: 1,
  dependencies: [],
  truncated: false,
  truncations: [],
  targetOrg: 'admin@example.com',
};

function truncationFlags(allowTruncated: boolean): DependenciesFlagValues {
  return {
    'api-name': 'Order_Processing',
    'target-org': createCommandOrg({} as Connection),
    direction: 'uses',
    recursive: false,
    'max-depth': 10,
    type: undefined,
    'exclude-type': undefined,
    format: 'table',
    'output-file': undefined,
    'fail-on-dependencies': false,
    'allow-truncated': allowTruncated,
    namespace: undefined,
    'api-version': undefined,
  };
}

function truncatedResult(): FlowDependenciesResult {
  return {
    ...result,
    truncated: true,
    truncations: [
      {
        definitionId: result.definitionId,
        apiName: result.apiName,
        namespace: null,
        direction: 'uses',
        depth: 3,
        limit: 2000,
      },
    ],
  };
}

describe('flow dependencies flags', (): void => {
  it('defaults to querying both directions', (): void => {
    expect(FlowDependencies.flags.direction.default).to.equal('both');
    expect(FlowDependencies.flags.recursive.default).to.equal(false);
    expect(FlowDependencies.flags['max-depth'].default).to.equal(10);
    expect(FlowDependencies.flags['api-name'].required).to.equal(true);
  });
});

describe('flow dependencies command execution', (): void => {
  it('passes the dependency direction to the service', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      direction: 'used-by' as const,
      recursive: true,
      'max-depth': 4,
      type: ['ApexClass', 'CustomObject'],
      'exclude-type': ['CustomObject'],
      format: 'table' as const,
      'output-file': undefined,
      'fail-on-dependencies': false,
      'allow-truncated': false,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowDependencies.prototype, 'parseFlags').resolves(flags);
    const dependencies = $$.SANDBOX.stub(FlowDependenciesService.prototype, 'getDependencies').resolves(result);
    const actual = await FlowDependencies.run(['--json']);
    expect(dependencies.firstCall.args[0]).to.deep.equal({
      apiName: 'Order_Processing',
      targetOrg: 'admin@example.com',
      direction: 'used-by',
      recursive: true,
      maxDepth: 4,
      types: ['ApexClass', 'CustomObject'],
      excludeTypes: ['CustomObject'],
    });
    expect(actual).to.equal(result);
  });
});

describe('flow dependencies CI execution', (): void => {
  it('sets a failing process status when requested and matching dependencies exist', async (): Promise<void> => {
    const flags = {
      'api-name': 'Order_Processing',
      'target-org': createCommandOrg({} as Connection),
      direction: 'both' as const,
      recursive: false,
      'max-depth': 10,
      type: undefined,
      'exclude-type': undefined,
      format: 'table' as const,
      'output-file': undefined,
      'fail-on-dependencies': true,
      'allow-truncated': false,
      namespace: undefined,
      'api-version': undefined,
    };
    $$.SANDBOX.stub(FlowDependencies.prototype, 'parseFlags').resolves(flags);
    $$.SANDBOX.stub(FlowDependenciesService.prototype, 'getDependencies').resolves({
      ...result,
      dependencies: [
        {
          sourceDefinitionId: result.definitionId,
          sourceApiName: result.apiName,
          sourceNamespace: null,
          depth: 0,
          direction: 'uses',
          componentId: '01I000000000001',
          name: 'Account',
          namespace: null,
          type: 'CustomObject',
        },
      ],
    });
    try {
      await FlowDependencies.run(['--json']);
      expect(process.exitCode).to.equal(1);
    } finally {
      process.exitCode = undefined;
    }
  });
});

describe('flow dependencies truncation execution', (): void => {
  it('fails by default when a dependency query reaches its limit', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowDependencies.prototype, 'parseFlags').resolves(truncationFlags(false));
    $$.SANDBOX.stub(FlowDependenciesService.prototype, 'getDependencies').resolves(truncatedResult());
    try {
      await FlowDependencies.run(['--json']);
      expect(process.exitCode).to.equal(1);
    } finally {
      process.exitCode = undefined;
    }
  });

  it('allows an explicit truncation opt-out to succeed', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowDependencies.prototype, 'parseFlags').resolves(truncationFlags(true));
    $$.SANDBOX.stub(FlowDependenciesService.prototype, 'getDependencies').resolves(truncatedResult());
    await FlowDependencies.run(['--json']);
    expect(process.exitCode).to.equal(undefined);
  });

  it('includes traversal depth in the human truncation warning', async (): Promise<void> => {
    $$.SANDBOX.stub(FlowDependencies.prototype, 'parseFlags').resolves(truncationFlags(true));
    $$.SANDBOX.stub(FlowDependenciesService.prototype, 'getDependencies').resolves(truncatedResult());
    await FlowDependencies.run([]);
    expect(commandUx.warn.firstCall.args[0]).to.include('(uses, depth 3)');
  });
});
