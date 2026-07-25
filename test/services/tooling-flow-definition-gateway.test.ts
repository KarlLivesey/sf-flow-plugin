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
  nextRecordsUrl?: string;
}

class ConnectionDouble {
  public readonly queries: string[] = [];
  public readonly queryMoreUrls: string[] = [];
  public readonly requests: unknown[] = [];
  public requestError?: Error;

  public readonly tooling = {
    query: (soql: string): Promise<unknown> => this.query(soql),
    queryMore: (url: string): Promise<unknown> => this.queryMore(url),
  };

  private readonly apiBaseUrl = 'https://example.my.salesforce.com/services/data/v65.0';
  private responseIndex = 0;

  public constructor(private readonly responses: ReadonlyArray<unknown>) {}

  public asConnection(): Connection {
    return this as unknown as Connection;
  }

  public baseUrl(): string {
    return this.apiBaseUrl;
  }

  public async request(input: unknown): Promise<unknown> {
    this.requests.push(input);
    if (this.requestError !== undefined) {
      throw this.requestError;
    }
    return {};
  }

  private async query(soql: string): Promise<unknown> {
    this.queries.push(soql);
    return this.nextResponse();
  }

  private async queryMore(url: string): Promise<unknown> {
    this.queryMoreUrls.push(url);
    return this.nextResponse();
  }

  private nextResponse(): unknown {
    const response = this.responses[this.responseIndex];
    this.responseIndex += 1;
    if (response instanceof Error) {
      throw response;
    }
    return response;
  }
}

function page(records: unknown[], options: Partial<QueryPage> = {}): QueryPage {
  return { done: true, totalSize: records.length, records, ...options };
}

function definitionRecord(namespace: string | null = null): Record<string, unknown> {
  return {
    Id: '300000000000001',
    DeveloperName: 'Order_Processing',
    NamespacePrefix: namespace,
    ActiveVersionId: '301000000000001',
    LatestVersionId: '301000000000002',
  };
}

function versionRecord(versionNumber: number): Record<string, unknown> {
  return {
    Id: `30100000000000${versionNumber}`,
    DefinitionId: '300000000000001',
    VersionNumber: versionNumber,
    Status: versionNumber === 1 ? 'Active' : 'Draft',
    MasterLabel: `Version ${versionNumber}`,
    ProcessType: 'Flow',
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

describe('ToolingFlowDefinitionGateway queries', (): void => {
  it('queries and maps definitions', async (): Promise<void> => {
    const connection = new ConnectionDouble([page([definitionRecord()])]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const definitions = await gateway.findDefinitions({ apiName: 'Order_Processing' });
    expect(connection.queries[0]).to.equal(
      "SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinition WHERE DeveloperName = 'Order_Processing'"
    );
    expect(definitions[0]).to.include({ apiName: 'Order_Processing', namespace: null });
  });

  it('uses the namespace to disambiguate definitions', async (): Promise<void> => {
    const connection = new ConnectionDouble([page([definitionRecord('example')])]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    await gateway.findDefinitions({ apiName: 'Order_Processing', namespace: 'example' });
    expect(connection.queries[0]).to.contain("NamespacePrefix = 'example'");
  });

  it('queries and maps versions in ascending order', async (): Promise<void> => {
    const connection = new ConnectionDouble([page([versionRecord(1), versionRecord(2)])]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const versions = await gateway.findVersions('300000000000001');
    expect(connection.queries[0]).to.equal(
      "SELECT Id, DefinitionId, VersionNumber, Status, MasterLabel, ProcessType FROM Flow WHERE DefinitionId = '300000000000001' ORDER BY VersionNumber ASC"
    );
    expect(versions.map((item) => item.versionNumber)).to.deep.equal([1, 2]);
    expect(versions[0]).to.include({ status: 'Active', label: 'Version 1', processType: 'Flow' });
  });

  it('maps nullable Salesforce definition fields', async (): Promise<void> => {
    const record = { ...definitionRecord(), ActiveVersionId: null, LatestVersionId: null };
    const gateway = new ToolingFlowDefinitionGateway(new ConnectionDouble([page([record])]).asConnection());
    const definitions = await gateway.findDefinitions({ apiName: 'Order_Processing' });
    expect(definitions[0]).to.include({ namespace: null, activeVersionId: null, latestVersionId: null });
  });

  it('collects paginated query results', async (): Promise<void> => {
    const first = page([definitionRecord()], { done: false, nextRecordsUrl: '/tooling/query/next' });
    const second = page([{ ...definitionRecord(), Id: '300000000000002' }]);
    const connection = new ConnectionDouble([first, second]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    const definitions = await gateway.findDefinitions({ apiName: 'Order_Processing' });
    expect(definitions).to.have.length(2);
    expect(connection.queryMoreUrls).to.deep.equal(['/tooling/query/next']);
  });
});

describe('ToolingFlowDefinitionGateway validation and update', (): void => {
  it('rejects unsafe API names before querying', async (): Promise<void> => {
    const connection = new ConnectionDouble([]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    await expectError(gateway.findDefinitions({ apiName: "Flow' OR Name != '" }), 'FlowActivationFailed');
    expect(connection.queries).to.deep.equal([]);
  });

  it('sends the expected PATCH path and metadata body', async (): Promise<void> => {
    const connection = new ConnectionDouble([]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    await gateway.updateActiveVersion('300000000000001', 7);
    expect(connection.requests[0]).to.deep.equal({
      method: 'PATCH',
      url: 'https://example.my.salesforce.com/services/data/v65.0/tooling/sobjects/FlowDefinition/300000000000001',
      body: '{"Metadata":{"activeVersionNumber":7}}',
    });
  });

  it('wraps update failures', async (): Promise<void> => {
    const connection = new ConnectionDouble([]);
    connection.requestError = new Error('secret response');
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    try {
      await gateway.updateActiveVersion('300000000000001', 7);
      expect.fail('Expected the update to fail.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).name).to.equal('FlowActivationFailed');
      expect((error as Error).message).not.to.contain('secret response');
    }
  });
});

describe('ToolingFlowDefinitionGateway response validation', (): void => {
  it('rejects malformed Salesforce records', async (): Promise<void> => {
    const gateway = new ToolingFlowDefinitionGateway(new ConnectionDouble([page([{ Id: 42 }])]).asConnection());
    await expectError(gateway.findDefinitions({ apiName: 'Order_Processing' }), 'FlowActivationFailed');
  });

  it('rejects unsafe names returned by Salesforce', async (): Promise<void> => {
    const record = { ...definitionRecord(), DeveloperName: "Flow' OR Name != '" };
    const gateway = new ToolingFlowDefinitionGateway(new ConnectionDouble([page([record])]).asConnection());
    await expectError(gateway.findDefinitions({ apiName: 'Order_Processing' }), 'FlowActivationFailed');
  });

  it('rejects malformed Tooling query pages', async (): Promise<void> => {
    const gateway = new ToolingFlowDefinitionGateway(
      new ConnectionDouble([{ done: true, totalSize: 1, records: 'not-an-array' }]).asConnection()
    );
    await expectError(gateway.findDefinitions({ apiName: 'Order_Processing' }), 'FlowActivationFailed');
  });

  it('rejects malformed Flow version records', async (): Promise<void> => {
    const record = { ...versionRecord(1), Status: '' };
    const gateway = new ToolingFlowDefinitionGateway(new ConnectionDouble([page([record])]).asConnection());
    await expectError(gateway.findVersions('300000000000001'), 'FlowActivationFailed');
  });
});

describe('ToolingFlowDefinitionGateway defensive validation', (): void => {
  it('rejects unsafe namespaces before querying', async (): Promise<void> => {
    const connection = new ConnectionDouble([]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    await expectError(
      gateway.findDefinitions({ apiName: 'Order_Processing', namespace: "bad'namespace" }),
      'FlowActivationFailed'
    );
    expect(connection.queries).to.deep.equal([]);
  });

  it('rejects pagination without a next-records URL', async (): Promise<void> => {
    const connection = new ConnectionDouble([page([], { done: false })]);
    const gateway = new ToolingFlowDefinitionGateway(connection.asConnection());
    await expectError(gateway.findDefinitions({ apiName: 'Order_Processing' }), 'FlowActivationFailed');
  });

  it('rejects versions belonging to another definition', async (): Promise<void> => {
    const record = { ...versionRecord(1), DefinitionId: '300000000000002' };
    const gateway = new ToolingFlowDefinitionGateway(new ConnectionDouble([page([record])]).asConnection());
    await expectError(gateway.findVersions('300000000000001'), 'FlowActivationFailed');
  });

  it('wraps Tooling API query failures', async (): Promise<void> => {
    const gateway = new ToolingFlowDefinitionGateway(
      new ConnectionDouble([new Error('unfiltered Salesforce error')]).asConnection()
    );
    try {
      await gateway.findDefinitions({ apiName: 'Order_Processing' });
      expect.fail('Expected the query to fail.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(Error);
      expect((error as Error).name).to.equal('FlowActivationFailed');
      expect((error as Error).message).not.to.contain('unfiltered Salesforce error');
    }
  });
});
