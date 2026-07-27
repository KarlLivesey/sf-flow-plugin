/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { createFlowDebugApex } from '../../src/utils/flow-debug-apex.js';
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
});

describe('Flow debug log parsing', (): void => {
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
});
