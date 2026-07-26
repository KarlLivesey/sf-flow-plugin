/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { flowMutationPermissionDenied } from '../../src/errors/flow-errors.js';
import { FlowDefinitionService } from '../../src/services/flow-definition-service.js';
import type {
  FlowActivationRequest,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowMutationOperation,
  FlowVersion,
  FlowVersionNumber,
} from '../../src/types/flow.js';

interface UpdateCall {
  definitionId: string;
  versionNumber: number | null;
}

class FakeGateway implements FlowDefinitionGateway {
  public readonly deletes: string[] = [];
  public readonly lookups: FlowDefinitionLookup[] = [];
  public readonly permissionChecks: FlowMutationOperation[] = [];
  public readonly updates: UpdateCall[] = [];
  public allowDefinitionUpdates = true;
  public definitionError?: Error;
  public updateError?: Error;
  private definitionCall = 0;
  private versionCall = 0;

  public constructor(
    private readonly definitionResponses: ReadonlyArray<ReadonlyArray<FlowDefinition>>,
    private readonly versionResponses: ReadonlyArray<ReadonlyArray<FlowVersion>>
  ) {}

  public async assertMutationAllowed(operation: FlowMutationOperation): Promise<void> {
    this.permissionChecks.push(operation);
    if (operation === 'update-definition' && !this.allowDefinitionUpdates) {
      throw flowMutationPermissionDenied('update Flow definitions');
    }
  }

  public async findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>> {
    if (this.definitionError !== undefined) {
      throw this.definitionError;
    }
    this.lookups.push(lookup);
    const response = this.definitionResponses[this.definitionCall] ?? this.definitionResponses.at(-1) ?? [];
    this.definitionCall += 1;
    return response;
  }

  public async findAllDefinitions(): Promise<ReadonlyArray<FlowDefinition>> {
    return this.definitionResponses[0] ?? [];
  }

  public async findVersions(_definitionId: string): Promise<ReadonlyArray<FlowVersion>> {
    void _definitionId;
    const response = this.versionResponses[this.versionCall] ?? this.versionResponses.at(-1) ?? [];
    this.versionCall += 1;
    return response;
  }

  public async findAllVersions(): Promise<ReadonlyArray<FlowVersion>> {
    return this.versionResponses.flat();
  }

  public async setActiveVersion(definitionId: string, versionNumber: FlowVersionNumber | null): Promise<void> {
    if (this.updateError !== undefined) {
      throw this.updateError;
    }
    this.updates.push({ definitionId, versionNumber });
  }

  public async deleteVersion(versionId: string): Promise<void> {
    this.deletes.push(versionId);
  }
}

function definition(activeVersionId: string | null = '301000000000001'): FlowDefinition {
  return {
    id: '300000000000001',
    apiName: 'Order_Processing',
    namespace: null,
    activeVersionId,
    latestVersionId: '301000000000002',
  };
}

function version(versionNumber: number): FlowVersion {
  return {
    id: `30100000000000${versionNumber}`,
    definitionId: '300000000000001',
    versionNumber,
    status: versionNumber === 1 ? 'Active' : 'Draft',
    label: `Version ${versionNumber}`,
    processType: 'Flow',
    createdDate: `2026-01-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
    lastModifiedDate: `2026-02-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function request(overrides: Partial<FlowActivationRequest> = {}): FlowActivationRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    requestedVersion: 'latest',
    dryRun: false,
    ...overrides,
  };
}

async function expectError(promise: Promise<unknown>, name: string, messagePart?: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected ${name}.`);
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).name).to.equal(name);
    if (messagePart !== undefined) {
      expect((error as Error).message).to.contain(messagePart);
    }
  }
}

describe('FlowDefinitionService planning', (): void => {
  it('rejects a missing definition', async (): Promise<void> => {
    const service = new FlowDefinitionService(new FakeGateway([[]], [[]]));
    await expectError(service.planActivation(request()), 'FlowDefinitionNotFound');
  });

  it('rejects ambiguous definitions', async (): Promise<void> => {
    const matches = [definition(), { ...definition(), id: '300000000000002', namespace: 'example' }];
    const service = new FlowDefinitionService(new FakeGateway([matches], [[version(1)]]));
    await expectError(service.planActivation(request()), 'FlowDefinitionAmbiguous');
  });

  it('plans the latest version and reports the previous active version', async (): Promise<void> => {
    const service = new FlowDefinitionService(new FakeGateway([[definition()]], [[version(1), version(2)]]));
    const plan = await service.planActivation(request());
    expect(plan.selectedVersion.versionNumber).to.equal(2);
    expect(plan.previousActiveVersion).to.equal(1);
    expect(plan.changeRequired).to.equal(true);
  });

  it('represents no previous active version as null', async (): Promise<void> => {
    const service = new FlowDefinitionService(new FakeGateway([[definition(null)]], [[version(1), version(2)]]));
    const plan = await service.planActivation(request());
    expect(plan.previousActiveVersion).to.equal(null);
  });

  it('passes the namespace to the gateway', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    await new FlowDefinitionService(gateway).planActivation(request({ namespace: 'example' }));
    expect(gateway.lookups[0]).to.deep.equal({ apiName: 'Order_Processing', namespace: 'example' });
  });

  it('rejects a requested version that does not exist', async (): Promise<void> => {
    const service = new FlowDefinitionService(new FakeGateway([[definition()]], [[version(1), version(2)]]));
    await expectError(service.planActivation(request({ requestedVersion: 9 })), 'FlowVersionNotFound');
  });

  it('adds the Flow API name to query failures', async (): Promise<void> => {
    const gateway = new FakeGateway([], []);
    gateway.definitionError = new Error('request failed');
    await expectError(
      new FlowDefinitionService(gateway).planActivation(request()),
      'FlowActivationFailed',
      'Order_Processing'
    );
  });
});

describe('FlowDefinitionService activation preflight', (): void => {
  it('does not update during a dry run', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    const result = await new FlowDefinitionService(gateway).activate(request({ dryRun: true }));
    expect(result.changed).to.equal(false);
    expect(result.dryRun).to.equal(true);
    expect(gateway.updates).to.deep.equal([]);
    expect(gateway.permissionChecks).to.deep.equal(['update-definition']);
  });

  it('is idempotent when the selected version is active', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition('301000000000002')]], [[version(1), version(2)]]);
    const result = await new FlowDefinitionService(gateway).activate(request());
    expect(result.changed).to.equal(false);
    expect(gateway.updates).to.deep.equal([]);
    expect(gateway.permissionChecks).to.deep.equal([]);
  });

  it('fails a dry run when the user cannot update Flow definitions', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    gateway.allowDefinitionUpdates = false;
    await expectError(
      new FlowDefinitionService(gateway).activate(request({ dryRun: true })),
      'FlowMutationPermissionDenied',
      'update Flow definitions'
    );
    expect(gateway.updates).to.deep.equal([]);
  });

  it('rejects a stale expected active version', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    await expectError(
      new FlowDefinitionService(gateway).activate(request({ expectedActiveVersion: 2 })),
      'FlowActiveVersionMismatch'
    );
    expect(gateway.updates).to.deep.equal([]);
  });
});

describe('FlowDefinitionService activation mutation', (): void => {
  it('updates and verifies the selected version', async (): Promise<void> => {
    const gateway = new FakeGateway(
      [[definition()], [definition('301000000000002')]],
      [
        [version(1), version(2)],
        [version(1), version(2)],
      ]
    );
    const result = await new FlowDefinitionService(gateway).activate(request());
    expect(gateway.updates).to.deep.equal([{ definitionId: '300000000000001', versionNumber: 2 }]);
    expect(gateway.permissionChecks).to.deep.equal(['update-definition']);
    expect(result.changed).to.equal(true);
    expect(result.activeVersion).to.equal(2);
  });

  it('wraps update failures', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    gateway.updateError = new Error('request failed');
    const activation = new FlowDefinitionService(gateway).activate(request());
    await expectError(activation, 'FlowActivationFailed', 'Order_Processing');
  });

  it('rejects a verification mismatch', async (): Promise<void> => {
    const gateway = new FakeGateway(
      [[definition()], [definition()]],
      [
        [version(1), version(2)],
        [version(1), version(2)],
      ]
    );
    const activation = new FlowDefinitionService(gateway).activate(request());
    await expectError(activation, 'FlowActivationVerificationFailed');
  });

  it('rechecks the expected active version immediately before updating', async (): Promise<void> => {
    const gateway = new FakeGateway(
      [[definition()], [definition('301000000000002')]],
      [
        [version(1), version(2)],
        [version(1), version(2)],
      ]
    );
    await expectError(
      new FlowDefinitionService(gateway).activate(request({ expectedActiveVersion: 1 })),
      'FlowActiveVersionMismatch'
    );
    expect(gateway.updates).to.deep.equal([]);
  });
});
