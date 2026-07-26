/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { parseFlowRuntimeBreakdown, summariseFlowRuntimeMetrics } from '../../src/utils/flow-runtime-metrics.js';

const request = {
  apiName: 'Order_Flow',
  namespace: null,
  version: 7,
  windowDays: 30,
} as const;

describe('Flow runtime metric outcomes', (): void => {
  it('trims blank text and treats it as absent', (): void => {
    const breakdown = parseFlowRuntimeBreakdown({
      runStatus: ' Complete ',
      errorReason: '   ',
      executions: 2,
    });
    expect(breakdown.status).to.equal('Complete');
    expect(breakdown.errorReason).to.equal(null);
    const result = summariseFlowRuntimeMetrics(request, '2026-07-01T00:00:00.000Z', [breakdown]);
    expect(result.successfulExecutions).to.equal(2);
    expect(result.failedExecutions).to.equal(0);
  });

  it('gives failure precedence over a successful status', (): void => {
    const breakdown = parseFlowRuntimeBreakdown({
      runStatus: 'Complete',
      errorReason: 'Unhandled fault',
      executions: 3,
    });
    const result = summariseFlowRuntimeMetrics(request, '2026-07-01T00:00:00.000Z', [breakdown]);
    expect(result.executions).to.equal(3);
    expect(result.successfulExecutions).to.equal(0);
    expect(result.failedExecutions).to.equal(3);
  });
});
