/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type { FlowCheckResult } from '../../src/types/flow-check.js';
import { formatFlowCheckSarif } from '../../src/utils/flow-check-analysis.js';

describe('Flow check SARIF output', (): void => {
  it('uses logical metadata locations instead of pretending paths are files', (): void => {
    const result: FlowCheckResult = {
      apiNames: ['Order_Flow'],
      requestedVersion: 'latest',
      subflowVersion: 'active',
      checks: ['lint'],
      excludedChecks: [],
      recursive: false,
      maxDepth: 10,
      allowTruncated: false,
      flows: [],
      findings: [
        {
          apiName: 'Order_Flow',
          namespace: null,
          version: 7,
          check: 'lint',
          code: 'unconnected-element',
          severity: 'warning',
          message: 'Element is unreachable.',
          path: 'assignments/Set_Total',
        },
      ],
      errors: 0,
      warnings: 1,
      targetOrg: 'admin@example.com',
    };
    const sarif = formatFlowCheckSarif(result);
    expect(sarif).to.contain('"logicalLocations"');
    expect(sarif).to.contain('"fullyQualifiedName": "Order_Flow:assignments/Set_Total"');
    expect(sarif).not.to.contain('"physicalLocation"');
  });
});
