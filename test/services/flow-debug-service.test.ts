/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowDebugService } from '../../src/services/flow-debug-service.js';
import { expectErrorName, FakeFlowGateway, flowDefinition } from '../helpers/fake-flow-gateway.js';
import {
  debugDefinitionId,
  debugLog,
  FakeDebugGateway,
  flowDebugGateways,
  flowDebugRequest,
  interviewId,
} from '../helpers/flow-debug-fixtures.js';

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
    expect(gateways.debug.availabilityChecks).to.deep.equal(['Calculate_Discount']);
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
});

describe('FlowDebugService rollback outcomes', (): void => {
  it('reports a caught Flow failure while retaining rollback confirmation', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.transport.rawLog = debugLog({ error: true });
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest());
    expect(artifact.result).to.include({ successful: false });
    expect(artifact.result.debug?.databaseChangesRolledBack).to.equal(true);
    expect(artifact.result.debug?.error?.message).to.equal('Salesforce reported a Flow error; details redacted.');
  });

  it('reports rollback as unknown when Salesforce terminates before its marker', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.transport.execution.success = false;
    gateways.debug.transport.rawLog = `10:00:00.0 (1)|USER_DEBUG|[1]|ERROR|SF_FLOW_PLUGIN_DEBUG|${correlationIdForTest()}|BEGIN`;
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest());
    expect(artifact.result).to.include({ successful: false });
    expect(artifact.result.debug?.databaseChangesRolledBack).to.equal(null);
  });
});

describe('FlowDebugService safety', (): void => {
  it('preflights rollback without tracing or executing the Flow', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.production = true;
    const artifact = await new FlowDebugService(gateways).debug(flowDebugRequest({ dryRun: true }));
    expect(gateways.debug.availabilityChecks).to.deep.equal(['Calculate_Discount']);
    expect(gateways.debug.executed).to.deep.equal([]);
    expect(artifact.rawLog).to.equal('');
    expect(artifact.result).to.include({ production: true, dryRun: true, successful: null });
    expect(artifact.result.invocations[0]).to.include({ executed: false, success: null });
    expect(artifact.result.debug).to.deep.include({
      correlationId: null,
      databaseChangesRolledBack: null,
      debugLog: null,
    });
  });

  it('rejects an oversized Execute Anonymous request during dry-run preflight', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    const input = { percentage: '10', secretToken: 'x'.repeat(12_000) };
    await expectErrorName(
      new FlowDebugService(gateways).debug(flowDebugRequest({ dryRun: true, input })),
      'FlowInputInvalid'
    );
    expect(gateways.debug.availabilityChecks).to.deep.equal([]);
  });

  it('requires confirmation for production even when rollback is enabled', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.production = true;
    await expectErrorName(
      new FlowDebugService(gateways).debug(flowDebugRequest()),
      'FlowProductionConfirmationRequired'
    );
    expect(gateways.debug.executed).to.deep.equal([]);
  });
});

describe('FlowDebugService log integrity', (): void => {
  for (const expected of [
    { marker: 'BEGIN', error: 'FlowDebugFailed' },
    { marker: 'OUTPUT', error: 'FlowDebugFailed' },
    { marker: 'ROLLBACK', error: 'FlowDebugRollbackFailed' },
  ]) {
    it(`rejects a successful transaction without its ${expected.marker} marker`, async (): Promise<void> => {
      const gateways = flowDebugGateways();
      gateways.debug.transport.rawLog = debugLog().replace(
        `|${correlationIdForTest()}|${expected.marker}`,
        `|wrong|${expected.marker}`
      );
      await expectErrorName(new FlowDebugService(gateways).debug(flowDebugRequest()), expected.error);
    });
  }

  it('wraps an incomplete output marker in a stable debug error', async (): Promise<void> => {
    const gateways = flowDebugGateways();
    gateways.debug.transport.rawLog = debugLog().replace('|OUTPUT|0|', '|OUTPUT|1|');
    const error = await new FlowDebugService(gateways).debug(flowDebugRequest()).catch((caught: unknown) => caught);
    expect(error).to.have.property('name', 'FlowDebugFailed');
    expect(error).to.have.property(
      'message',
      'The correlated Salesforce debug log was malformed or incomplete. ApexLog ID: 07L000000000001.'
    );
  });
});

describe('FlowDebugService managed Flow identity', (): void => {
  it('qualifies a managed Flow when no active version exists', async (): Promise<void> => {
    const managed = {
      ...flowDefinition({
        id: debugDefinitionId,
        apiName: 'Calculate_Discount',
        activeVersionId: null,
        latestVersionId: null,
      }),
      namespace: 'managed',
    };
    const error = await new FlowDebugService({
      definition: new FakeFlowGateway([managed], []),
      debug: new FakeDebugGateway(),
    })
      .debug(flowDebugRequest({ namespace: 'managed' }))
      .catch((caught: unknown) => caught);
    expect(error).to.have.property('message').that.includes('managed__Calculate_Discount');
  });
});

function correlationIdForTest(): string {
  return flowDebugGateways().debug.transport.correlationId;
}
