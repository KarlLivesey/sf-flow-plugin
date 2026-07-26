/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowRunService } from '../../src/services/flow-run-service.js';
import type { JsonObject } from '../../src/types/flow-analysis.js';
import type { FlowActionResult, FlowInvocationGateway, FlowRunRequest } from '../../src/types/flow-invocation.js';
import type { FlowVersion } from '../../src/types/flow.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';

class FakeInvocationGateway implements FlowInvocationGateway {
  public readonly invoked: JsonObject[][] = [];
  public availabilityChecks: string[] = [];
  public production = false;
  public onAvailabilityCheck: (() => Promise<void>) | undefined;
  public results: FlowActionResult[] = [
    { errors: [], invocationId: 'interview-1', isSuccess: true, outputValues: { discount: 10 }, version: 1 },
  ];

  public async isProductionOrg(): Promise<boolean> {
    return this.production;
  }

  public async assertFlowActionAvailable(apiName: string): Promise<void> {
    this.availabilityChecks.push(apiName);
    await this.onAvailabilityCheck?.();
  }

  public async invokeFlow(_apiName: string, inputs: ReadonlyArray<JsonObject>): Promise<FlowActionResult[]> {
    void _apiName;
    this.invoked.push([...inputs]);
    return this.results;
  }
}

function request(overrides: Partial<FlowRunRequest> = {}): FlowRunRequest {
  return {
    apiName: 'Calculate_Discount',
    targetOrg: 'admin@example.com',
    invocations: [{ percentage: '10', secretToken: 'sensitive' }],
    dryRun: false,
    confirm: false,
    ...overrides,
  };
}

function runnableVersion(): FlowVersion {
  return { ...flowVersion(definitionId, 1, 'Active'), processType: 'AutoLaunchedFlow' };
}

function gateways(): { definition: FakeFlowGateway; invocation: FakeInvocationGateway } {
  const version = runnableVersion();
  const definition = new FakeFlowGateway(
    [
      flowDefinition({
        id: definitionId,
        apiName: 'Calculate_Discount',
        activeVersionId: version.id,
        latestVersionId: version.id,
      }),
    ],
    [version]
  );
  definition.metadata.set(version.id, {
    variables: [
      {
        name: 'percentage',
        dataType: 'Number',
        isCollection: false,
        isInput: true,
        isOutput: false,
      },
      {
        name: 'secretToken',
        dataType: 'String',
        isCollection: false,
        isInput: true,
        isOutput: false,
      },
    ],
  });
  return { definition, invocation: new FakeInvocationGateway() };
}

describe('FlowRunService execution', (): void => {
  it('validates, invokes and redacts Flow values', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.results = [
      {
        errors: [],
        invocationId: 'interview-1',
        isSuccess: true,
        outputValues: { discount: 10, sessionToken: 'sensitive' },
        version: 1,
      },
    ];
    const result = await new FlowRunService(fake).run(request());
    expect(fake.invocation.invoked).to.deep.equal([[{ percentage: 10, secretToken: 'sensitive' }]]);
    expect(result.invocations[0]).to.deep.include({
      interviewId: 'interview-1',
      success: true,
      inputs: { percentage: 10, secretToken: '[REDACTED]' },
      outputs: { discount: 10, sessionToken: '[REDACTED]' },
      executed: true,
    });
  });

  it('returns normalised Flow errors', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.results = [
      {
        errors: ['plain error', { message: 'structured error', statusCode: 'FLOW_ERROR' }],
        isSuccess: false,
        outputValues: {},
      },
    ];
    const result = await new FlowRunService(fake).run(request());
    expect(result.successful).to.equal(false);
    expect(result.invocations[0]?.errors).to.deep.equal([
      { message: 'Salesforce reported a Flow error; message redacted.', code: null },
      { message: 'Salesforce reported a Flow error; message redacted.', code: 'FLOW_ERROR' },
    ]);
  });
});

describe('FlowRunService batch execution', (): void => {
  it('submits multiple inputs in one action request and preserves result order', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.results = [
      { errors: [], invocationId: 'first', isSuccess: true, outputValues: { discount: 10 }, version: 1 },
      { errors: [], invocationId: 'second', isSuccess: true, outputValues: { discount: 20 }, version: 1 },
    ];
    const invocations = [{ percentage: '10' }, { percentage: '20' }];
    const result = await new FlowRunService(fake).run(request({ invocations }));
    expect(fake.invocation.invoked).to.deep.equal([[{ percentage: 10 }, { percentage: 20 }]]);
    expect(result.invocations.map((invocation) => invocation.interviewId)).to.deep.equal(['first', 'second']);
    expect(result.durationMilliseconds).to.be.at.least(0);
    expect(result.invocations.every((invocation) => !('durationMilliseconds' in invocation))).to.equal(true);
  });

  it('rejects an invocation result count that does not match the submitted inputs', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.results = [];
    await expectErrorName(new FlowRunService(fake).run(request()), 'FlowInvocationFailed');
    expect(fake.invocation.invoked).to.have.length(1);
  });

  it('reports the active version returned by the action request consistently', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.results = [
      { errors: [], invocationId: 'interview-2', isSuccess: true, outputValues: {}, version: 2 },
      { errors: [], invocationId: 'interview-3', isSuccess: true, outputValues: {} },
    ];
    const result = await new FlowRunService(fake).run(
      request({ invocations: [{ percentage: '10' }, { percentage: '20' }] })
    );
    expect(result.version).to.equal(2);
    expect(result.invocations.map((invocation) => invocation.version)).to.deep.equal([2, 2]);
  });
});

describe('FlowRunService safety', (): void => {
  it('rejects more than the platform batch limit before querying or execution', async (): Promise<void> => {
    const fake = gateways();
    const invocations = Array.from({ length: 201 }, () => ({}));
    await expectErrorName(new FlowRunService(fake).run(request({ invocations })), 'FlowInputInvalid');
    expect(fake.definition.versionQueries).to.deep.equal([]);
    expect(fake.invocation.invoked).to.deep.equal([]);
  });

  it('performs permission preflight without execution during dry-run', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.production = true;
    const result = await new FlowRunService(fake).run(request({ dryRun: true }));
    expect(fake.invocation.availabilityChecks).to.deep.equal(['Calculate_Discount']);
    expect(fake.invocation.invoked).to.deep.equal([]);
    expect(result).to.include({ production: true, dryRun: true, successful: true });
    expect(result).to.include({ durationMilliseconds: 0 });
    expect(result.invocations[0]).to.include({ executed: false });
  });

  it('requires explicit confirmation before production execution', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.production = true;
    await expectErrorName(new FlowRunService(fake).run(request()), 'FlowProductionConfirmationRequired');
    expect(fake.invocation.invoked).to.deep.equal([]);
  });

  it('executes in production after explicit confirmation', async (): Promise<void> => {
    const fake = gateways();
    fake.invocation.production = true;
    const result = await new FlowRunService(fake).run(request({ confirm: true }));
    expect(result).to.include({ production: true, successful: true });
    expect(fake.invocation.invoked).to.have.length(1);
  });
});

describe('FlowRunService active-version guard', (): void => {
  it('refuses execution when the active version changes during preflight', async (): Promise<void> => {
    const first = runnableVersion();
    const second = { ...flowVersion(definitionId, 2, 'Active'), processType: 'AutoLaunchedFlow' };
    const definition = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Calculate_Discount',
          activeVersionId: first.id,
          latestVersionId: second.id,
        }),
      ],
      [first, second]
    );
    definition.metadata.set(first.id, {
      variables: [
        {
          name: 'percentage',
          dataType: 'Number',
          isCollection: false,
          isInput: true,
          isOutput: false,
        },
      ],
    });
    const invocation = new FakeInvocationGateway();
    invocation.onAvailabilityCheck = async (): Promise<void> => {
      await definition.setActiveVersion(definitionId, 2);
    };
    await expectErrorName(
      new FlowRunService({ definition, invocation }).run(request({ invocations: [{ percentage: '10' }] })),
      'FlowInvocationFailed'
    );
    expect(invocation.invoked).to.deep.equal([]);
  });
});

describe('FlowRunService eligibility', (): void => {
  it('rejects non-autolaunched Flow versions', async (): Promise<void> => {
    const fake = gateways();
    const version = runnableVersion();
    version.processType = 'Flow';
    const invalid = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Calculate_Discount',
          activeVersionId: version.id,
          latestVersionId: version.id,
        }),
      ],
      [version]
    );
    invalid.metadata.set(version.id, {});
    await expectErrorName(
      new FlowRunService({ definition: invalid, invocation: fake.invocation }).run(request()),
      'FlowInvocationFailed'
    );
  });

  it('rejects record-triggered autolaunched Flows', async (): Promise<void> => {
    const fake = gateways();
    const version = runnableVersion();
    fake.definition.metadata.set(version.id, { start: { triggerType: 'RecordAfterSave' } });
    await expectErrorName(new FlowRunService(fake).run(request({ invocations: [{}] })), 'FlowInvocationFailed');
  });
});
