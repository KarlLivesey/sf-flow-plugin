/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { expect } from 'chai';

import { ToolingFlowDefinitionGateway } from '../../src/services/tooling-flow-definition-gateway.js';

interface QueryPage {
  done: boolean;
  totalSize: number;
  records: unknown[];
}

class QueryConnectionDouble {
  public readonly queries: string[] = [];
  public readonly tooling = {
    query: (soql: string): Promise<unknown> => this.query(soql),
  };

  public constructor(private readonly response: unknown) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  private async query(soql: string): Promise<unknown> {
    this.queries.push(soql);
    return this.response;
  }
}

function page(records: unknown[]): QueryPage {
  return { done: true, totalSize: records.length, records };
}

function dependencyRecord(): Record<string, unknown> {
  return {
    MetadataComponentId: '300000000000001',
    MetadataComponentName: 'Order_Processing',
    MetadataComponentNamespace: null,
    MetadataComponentType: 'Flow',
    RefMetadataComponentId: '01I000000000001',
    RefMetadataComponentName: 'Account',
    RefMetadataComponentNamespace: null,
    RefMetadataComponentType: 'CustomObject',
  };
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

describe('ToolingFlowDefinitionGateway metadata queries', (): void => {
  it('queries and validates one Flow version metadata record', async (): Promise<void> => {
    const record = { Id: '301000000000001', Metadata: { status: 'Draft', assignments: [] } };
    const connection = new QueryConnectionDouble(page([record]));
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const metadata = await gateway.getVersionMetadata('301000000000001');
    expect(connection.queries[0]).to.equal("SELECT Id, Metadata FROM Flow WHERE Id = '301000000000001'");
    expect(metadata).to.deep.equal(record.Metadata);
  });

  it('rejects malformed Flow metadata', async (): Promise<void> => {
    const record = { Id: '301000000000001', Metadata: { invalid: undefined } };
    const gateway = new ToolingFlowDefinitionGateway(new QueryConnectionDouble(page([record])).asConnection());
    await expectError(gateway.getVersionMetadata('301000000000001'), 'FlowQueryFailed');
  });
});

describe('ToolingFlowDefinitionGateway dependency queries', (): void => {
  it('queries outgoing dependencies by resolved Flow definition ID', async (): Promise<void> => {
    const connection = new QueryConnectionDouble(page([dependencyRecord()]));
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const dependencies = await gateway.findDependencies('300000000000001', 'uses');
    expect(connection.queries[0]).to.contain("WHERE MetadataComponentId = '300000000000001'");
    expect(connection.queries[0]).to.match(/LIMIT 2000$/);
    expect(dependencies[0]).to.deep.equal({
      direction: 'uses',
      componentId: '01I000000000001',
      name: 'Account',
      namespace: null,
      type: 'CustomObject',
    });
  });

  it('maps incoming dependencies from the referencing component fields', async (): Promise<void> => {
    const connection = new QueryConnectionDouble(page([dependencyRecord()]));
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const dependencies = await gateway.findDependencies('300000000000001', 'used-by');
    expect(connection.queries[0]).to.contain("WHERE RefMetadataComponentId = '300000000000001'");
    expect(connection.queries[0]).to.match(/LIMIT 2000$/);
    expect(dependencies[0]).to.include({ direction: 'used-by', name: 'Order_Processing', type: 'Flow' });
  });
});
