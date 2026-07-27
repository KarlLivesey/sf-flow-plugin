/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDebugGateway, FlowDebugTransportResult } from '../../src/types/flow-debug.js';
import type { FlowRollbackRequest } from '../../src/types/flow-invocation.js';
import type { FlowVersion } from '../../src/types/flow.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from './fake-flow-gateway.js';

export const debugDefinitionId = '300000000000001';
export const debugVersionId = '301000000000001';
export const correlationId = '12345678-1234-1234-1234-123456789abc';
export const interviewId = '451708570adb72f82d7b3d6a362c16b7611327e-1b08';

export function debugLog(options: { error?: boolean } = {}): string {
  const output = Buffer.from(JSON.stringify({ discount: 10, secretToken: 'output-secret' }), 'utf8').toString('base64');
  const encodedError = Buffer.from(
    JSON.stringify({ type: 'System.FlowException', message: 'Sensitive Flow failure' }),
    'utf8'
  ).toString('base64');
  return [
    '65.0 APEX_CODE,DEBUG;WORKFLOW,FINER',
    `10:00:00.0 (1)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationId}|BEGIN`,
    `10:00:00.1 (2)|FLOW_START_INTERVIEW_BEGIN|${interviewId}|Calculate Discount`,
    `10:00:00.2 (3)|FLOW_ELEMENT_BEGIN|${interviewId}|FlowAssignment|Set_Discount`,
    `10:00:00.3 (4)|FLOW_VALUE_ASSIGNMENT|${interviewId}|discount|10`,
    `10:00:00.4 (5)|FLOW_ELEMENT_END|${interviewId}|FlowAssignment|Set_Discount`,
    options.error === true
      ? `10:00:00.5 (6)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationId}|ERROR|${encodedError}`
      : `10:00:00.5 (6)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationId}|OUTPUT|0|${output}`,
    `10:00:00.6 (7)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationId}|ROLLBACK`,
    `10:00:00.7 (8)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationId}|END`,
  ].join('\n');
}

export class FakeDebugGateway implements FlowDebugGateway {
  public executed: Array<Parameters<FlowDebugGateway['execute']>[0]> = [];
  public production = false;
  public transport: FlowDebugTransportResult = {
    correlationId,
    execution: { compiled: true, success: true, line: -1, column: -1 },
    log: {
      id: '07L000000000001',
      status: 'Success',
      operation: 'executeAnonymous',
      startTime: '2026-07-27T10:00:00.000Z',
      durationMilliseconds: 25,
      logLength: 1000,
    },
    rawLog: debugLog(),
  };

  public async execute(request: Parameters<FlowDebugGateway['execute']>[0]): Promise<FlowDebugTransportResult> {
    this.executed.push(request);
    return this.transport;
  }

  public async isProductionOrg(): Promise<boolean> {
    return this.production;
  }
}

export function debuggableVersion(): FlowVersion {
  return {
    ...flowVersion(debugDefinitionId, 1, 'Active'),
    id: debugVersionId,
    processType: 'AutoLaunchedFlow',
  };
}

export function flowDebugGateways(): { definition: FakeFlowGateway; debug: FakeDebugGateway } {
  const version = debuggableVersion();
  const definition = new FakeFlowGateway(
    [
      flowDefinition({
        id: debugDefinitionId,
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
        name: 'discount',
        dataType: 'Number',
        isCollection: false,
        isInput: false,
        isOutput: true,
      },
      {
        name: 'secretToken',
        dataType: 'String',
        isCollection: false,
        isInput: true,
        isOutput: true,
      },
    ],
  });
  return { definition, debug: new FakeDebugGateway() };
}

export function flowDebugRequest(overrides: Partial<FlowRollbackRequest> = {}): FlowRollbackRequest {
  return {
    apiName: 'Calculate_Discount',
    targetOrg: 'admin@example.com',
    input: { percentage: '10', secretToken: 'input-secret' },
    confirm: false,
    logLevel: 'detailed',
    showValues: false,
    waitMilliseconds: 120_000,
    ...overrides,
  };
}
