/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../../src/types/flow-analysis.js';
import type { FlowActionResult, FlowInvocationGateway, FlowRunRequest } from '../../src/types/flow-invocation.js';
import type { FlowVersion } from '../../src/types/flow.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from './fake-flow-gateway.js';

export const definitionId = '300000000000001';

export class FakeInvocationGateway implements FlowInvocationGateway {
  public readonly invoked: JsonObject[][] = [];
  public availabilityChecks: string[] = [];
  public production = false;
  public onAvailabilityCheck: (() => Promise<void>) | undefined;
  public results: FlowActionResult[] = [
    {
      errors: [],
      invocationId: null,
      isSuccess: true,
      outputValues: { discount: 10, ['Flow__InterviewGuid']: 'interview-1' },
      version: 1,
    },
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

export function flowRunRequest(overrides: Partial<FlowRunRequest> = {}): FlowRunRequest {
  return {
    apiName: 'Calculate_Discount',
    targetOrg: 'admin@example.com',
    invocations: [{ percentage: '10', secretToken: 'sensitive' }],
    dryRun: false,
    confirm: false,
    ...overrides,
  };
}

export function runnableVersion(): FlowVersion {
  return { ...flowVersion(definitionId, 1, 'Active'), processType: 'AutoLaunchedFlow' };
}

export function flowRunGateways(): { definition: FakeFlowGateway; invocation: FakeInvocationGateway } {
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
