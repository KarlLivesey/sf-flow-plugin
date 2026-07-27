/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { createBoundedFlowDebugApex, createFlowDebugApex } from '../../src/utils/flow-debug-apex.js';
import { parseFlowDebugLog } from '../../src/utils/flow-debug-log.js';
import { correlationId, debugLog, interviewId } from '../helpers/flow-debug-fixtures.js';

describe('Flow debug Apex generation', (): void => {
  it('starts the selected managed Flow and explicitly rolls back', (): void => {
    const source = createFlowDebugApex({
      correlationId,
      apiName: 'Calculate_Discount',
      namespace: 'managed',
      input: { percentage: 10 },
      outputVariables: ['discount'],
    });
    expect(source).to.include("Flow.Interview.createInterview('managed', 'Calculate_Discount', sfFlowInputs)");
    expect(source).to.include('Savepoint sfFlowSavepoint = Database.setSavepoint();');
    expect(source).to.include('Database.rollback(sfFlowSavepoint);');
    expect(source).to.include(`SF_FLOW_PLUGIN_DEBUG|${correlationId}`);
    expect(source).not.to.include('{"percentage":10}');
  });

  it('starts an unmanaged Flow with the same rollback contract', (): void => {
    const source = createFlowDebugApex({
      correlationId,
      apiName: 'Calculate_Discount',
      namespace: null,
      input: {},
      outputVariables: [],
    });
    expect(source).to.include("Flow.Interview.createInterview('Calculate_Discount', sfFlowInputs)");
    expect(source).to.include("'|ROLLBACK'");
    expect(source).to.include('Database.setSavepoint');
    expect(source).to.include('Database.rollback');
  });

  it('rejects source that cannot fit safely in the REST Execute Anonymous URI', (): void => {
    expect(() =>
      createBoundedFlowDebugApex({
        correlationId,
        apiName: 'Calculate_Discount',
        namespace: null,
        input: { value: 'x'.repeat(12_000) },
        outputVariables: [],
      })
    ).to.throw('Execute Anonymous URI');
  });
});

describe('Flow debug log value parsing', (): void => {
  it('finds the interview, trace and output while redacting values', (): void => {
    const parsed = parseFlowDebugLog(debugLog(), correlationId, false);
    expect(parsed).to.include({ interviewId, rollbackMarker: true, endMarker: true });
    expect(parsed.outputs).to.deep.equal({ discount: 10, secretToken: 'output-secret' });
    expect(parsed.events.map((event) => event.event)).to.include.members([
      'FLOW_START_INTERVIEW_BEGIN',
      'FLOW_ELEMENT_BEGIN',
      'FLOW_VALUE_ASSIGNMENT',
      'FLOW_ELEMENT_END',
    ]);
    expect(parsed.events.find((event) => event.event === 'FLOW_VALUE_ASSIGNMENT')?.detail).to.equal('[REDACTED]');
  });

  it('shows values and a caught Flow error only when requested', (): void => {
    const hidden = parseFlowDebugLog(debugLog({ error: true }), correlationId, false);
    expect(hidden.error?.message).to.equal('Salesforce reported a Flow error; details redacted.');
    const shown = parseFlowDebugLog(debugLog({ error: true }), correlationId, true);
    expect(shown.error).to.deep.equal({ type: 'System.FlowException', message: 'Sensitive Flow failure' });
    expect(shown.events.find((event) => event.event === 'FLOW_VALUE_ASSIGNMENT')?.detail).to.include('|discount|10');
  });

  it('redacts action and fault details unless values are requested', (): void => {
    const rawLog = [
      `10:00:00.0 (1)|FLOW_ACTIONCALL_DETAIL|${interviewId}|Action|secret-input`,
      `10:00:00.1 (2)|FLOW_ELEMENT_FAULT|${interviewId}|Sensitive Flow failure`,
    ].join('\n');
    const hidden = parseFlowDebugLog(rawLog, correlationId, false);
    expect(hidden.events.map((event) => event.detail)).to.deep.equal(['[REDACTED]', '[REDACTED]']);
    const shown = parseFlowDebugLog(rawLog, correlationId, true);
    expect(shown.events.map((event) => event.detail)).to.deep.equal([
      `${interviewId}|Action|secret-input`,
      `${interviewId}|Sensitive Flow failure`,
    ]);
  });
});

describe('Flow debug log integrity', (): void => {
  it('rejects missing and duplicate output chunks', (): void => {
    const begin = `SF_FLOW_PLUGIN_DEBUG|${correlationId}|BEGIN`;
    const marker = `SF_FLOW_PLUGIN_DEBUG|${correlationId}|OUTPUT`;
    expect(() => parseFlowDebugLog(`${begin}\n${marker}|1|e30=`, correlationId, false)).to.throw(
      'missing an output chunk'
    );
    expect(() => parseFlowDebugLog(`${begin}\n${marker}|0|e3\n${marker}|0|0=`, correlationId, false)).to.throw(
      'duplicate output chunk'
    );
  });

  it('rejects out-of-order and unknown execution markers', (): void => {
    const marker = `SF_FLOW_PLUGIN_DEBUG|${correlationId}|`;
    expect(() => parseFlowDebugLog(`${marker}ROLLBACK\n${marker}BEGIN`, correlationId, false)).to.throw(
      'out-of-order rollback marker'
    );
    expect(() => parseFlowDebugLog(`${marker}BEGIN\n${marker}UNKNOWN`, correlationId, false)).to.throw(
      'unknown execution marker'
    );
  });
});
