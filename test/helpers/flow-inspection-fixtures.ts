/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../../src/types/flow-analysis.js';
import type { FlowDescribeRequest } from '../../src/types/flow-inspection.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from './fake-flow-gateway.js';

const flowAId = '300000000000001';
const flowBId = '300000000000101';

export function inspectionRequest(overrides: Partial<FlowDescribeRequest> = {}): FlowDescribeRequest {
  return {
    apiName: 'Flow_A',
    targetOrg: 'admin@example.com',
    version: 'latest',
    subflowVersion: 'active',
    recursive: true,
    maxDepth: 10,
    ...overrides,
  };
}

export function subflowMetadata(flowName: string): JsonObject {
  return {
    start: { connector: { targetReference: 'Call_Subflow' } },
    subflows: [
      {
        name: 'Call_Subflow',
        label: `Call ${flowName}`,
        flowName,
      },
    ],
  };
}

export function nestedFlowGateway(): FakeFlowGateway {
  const versionA = flowVersion(flowAId, 1, 'Active');
  const versionB = flowVersion(flowBId, 2, 'Active');
  const gateway = new FakeFlowGateway(
    [
      flowDefinition({
        id: flowAId,
        apiName: 'Flow_A',
        activeVersionId: versionA.id,
        latestVersionId: versionA.id,
      }),
      flowDefinition({
        id: flowBId,
        apiName: 'Flow_B',
        activeVersionId: versionB.id,
        latestVersionId: versionB.id,
      }),
    ],
    [versionA, versionB]
  );
  gateway.metadata.set(versionA.id, {
    ...subflowMetadata('Flow_B'),
    variables: [
      {
        name: 'InputValue',
        dataType: 'String',
        isCollection: false,
        isInput: true,
        isOutput: false,
      },
    ],
    formulas: [{ name: 'Greeting', dataType: 'String', expression: '"Hello"' }],
  });
  gateway.metadata.set(versionB.id, {});
  return gateway;
}

export function versionedSubflowGateway(active: boolean): FakeFlowGateway {
  const rootVersion = flowVersion(flowAId, 1, 'Active');
  const activeChild = flowVersion(flowBId, 1, 'Active');
  const latestChild = flowVersion(flowBId, 2, 'Draft');
  const gateway = new FakeFlowGateway(
    [
      flowDefinition({
        id: flowAId,
        apiName: 'Flow_A',
        activeVersionId: rootVersion.id,
        latestVersionId: rootVersion.id,
      }),
      flowDefinition({
        id: flowBId,
        apiName: 'Flow_B',
        activeVersionId: active ? activeChild.id : null,
        latestVersionId: latestChild.id,
      }),
    ],
    [rootVersion, activeChild, latestChild]
  );
  gateway.metadata.set(rootVersion.id, subflowMetadata('Flow_B'));
  gateway.metadata.set(activeChild.id, {});
  gateway.metadata.set(latestChild.id, {});
  return gateway;
}
