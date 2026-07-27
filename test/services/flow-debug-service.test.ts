/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDebugService } from '../../src/services/flow-debug-service.js';
import { expectErrorName } from '../helpers/fake-flow-gateway.js';
import { debugLog, flowDebugGateways, flowDebugRequest, interviewId } from '../helpers/flow-debug-fixtures.js';

describe('FlowDebugService rollback execution', (): void => {
  it('validates one invocation, rolls back and returns its correlated trace', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest());
    expect(gateways.debug.executed[0]).to.deep.include({
      apiName: 'Calculate_Discount',
      namespace: null,
      input: { percentage: 10, secretToken: 'input-secret' },
      outputVariables: ['discount', 'secretToken'],
      logLevel: 'detailed',
    });
    expect(artifact.result).to.include({
      successful: true,
      dryRun: false,
    });
    expect(artifact.result.debug).to.deep.include({
      correlationId: gateways.debug.transport.correlationId,
      databaseChangesRolledBack: true,
      valuesShown: false,
    });
    expect(artifact.result.invocations[0]).to.deep.include({ interviewId, success: true });
    expect(artifact.result.invocations[0]?.inputs).to.deep.equal({
      percentage: '[REDACTED]',
      secretToken: '[REDACTED]',
    });
    expect(artifact.result.invocations[0]?.outputs).to.deep.equal({
      discount: '[REDACTED]',
      secretToken: '[REDACTED]',
    });
    expect(artifact.rawLog).to.include('FLOW_ELEMENT_BEGIN');
  });

  it('shows values when explicitly requested', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest({ showValues: true }));
    expect(artifact.result.debug).to.deep.include({ databaseChangesRolledBack: true, valuesShown: true });
    expect(artifact.result.invocations[0]?.inputs).to.deep.equal({ percentage: 10, secretToken: 'input-secret' });
    expect(artifact.result.invocations[0]?.outputs).to.deep.equal({ discount: 10, secretToken: 'output-secret' });
  });

  it('reports a caught Flow failure while retaining rollback confirmation', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.transport.rawLog = debugLog({ error: true });
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest());
    expect(artifact.result).to.include({ successful: false });
    expect(artifact.result.debug?.databaseChangesRolledBack).to.equal(true);
    expect(artifact.result.debug?.error?.message).to.equal('Salesforce reported a Flow error; details redacted.');
  });
});

describe('FlowDebugService safety', (): void => {
  it('requires confirmation for production even when rollback is enabled', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.production = true;
    await expectErrorName(
      new FlowDebugService(gateways).debug(flowDebugRequest()),
      'FlowProductionConfirmationRequired'
    );
    expect(gateways.debug.executed).to.deep.equal([]);
  });

  it('rejects a successful transaction without the rollback marker', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.transport.rawLog = debugLog().replace(`|${correlationIdForTest()}|ROLLBACK`, '|wrong|ROLLBACK');
    await expectErrorName(new FlowDebugService(gateways).debug(flowDebugRequest()), 'FlowDebugRollbackFailed');
  });
});

function correlationIdForTest(): string {
  return flowDebugGateways().debug.transport.correlationId;
}
