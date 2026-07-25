import { expect } from 'chai';

import { FlowDefinitionService } from '../../src/services/flow-definition-service.js';
import type {
  FlowActivationRequest,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowVersion,
  FlowVersionNumber,
} from '../../src/types/flow.js';

interface UpdateCall {
  definitionId: string;
  versionNumber: number;
}

class FakeGateway implements FlowDefinitionGateway {
  public readonly lookups: FlowDefinitionLookup[] = [];
  public readonly updates: UpdateCall[] = [];
  public updateError?: Error;
  private definitionCall = 0;
  private versionCall = 0;

  public constructor(
    private readonly definitionResponses: ReadonlyArray<ReadonlyArray<FlowDefinition>>,
    private readonly versionResponses: ReadonlyArray<ReadonlyArray<FlowVersion>>
  ) {}

  public async findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>> {
    this.lookups.push(lookup);
    const response = this.definitionResponses[this.definitionCall] ?? this.definitionResponses.at(-1) ?? [];
    this.definitionCall += 1;
    return response;
  }

  public async findVersions(_definitionId: string): Promise<ReadonlyArray<FlowVersion>> {
    void _definitionId;
    const response = this.versionResponses[this.versionCall] ?? this.versionResponses.at(-1) ?? [];
    this.versionCall += 1;
    return response;
  }

  public async updateActiveVersion(definitionId: string, versionNumber: FlowVersionNumber): Promise<void> {
    if (this.updateError !== undefined) {
      throw this.updateError;
    }
    this.updates.push({ definitionId, versionNumber });
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

async function expectError(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected ${name}.`);
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).name).to.equal(name);
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
});

describe('FlowDefinitionService activation', (): void => {
  it('does not update during a dry run', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    const result = await new FlowDefinitionService(gateway).activate(request({ dryRun: true }));
    expect(result.changed).to.equal(false);
    expect(result.dryRun).to.equal(true);
    expect(gateway.updates).to.deep.equal([]);
  });

  it('is idempotent when the selected version is active', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition('301000000000002')]], [[version(1), version(2)]]);
    const result = await new FlowDefinitionService(gateway).activate(request());
    expect(result.changed).to.equal(false);
    expect(gateway.updates).to.deep.equal([]);
  });

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
    expect(result.changed).to.equal(true);
    expect(result.activeVersion).to.equal(2);
  });

  it('wraps update failures', async (): Promise<void> => {
    const gateway = new FakeGateway([[definition()]], [[version(1), version(2)]]);
    gateway.updateError = new Error('request failed');
    const activation = new FlowDefinitionService(gateway).activate(request());
    await expectError(activation, 'FlowActivationFailed');
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
});
