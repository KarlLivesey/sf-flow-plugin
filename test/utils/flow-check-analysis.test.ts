/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type { FlowCheckResult } from '../../src/types/flow-check.js';
import { formatFlowCheckHuman, formatFlowCheckSarif } from '../../src/utils/flow-check-analysis.js';

describe('Flow check SARIF output', (): void => {
  it('uses qualified Flow and metadata locations instead of pretending paths are files', (): void => {
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
          namespace: 'managed',
          version: 7,
          check: 'lint',
          code: 'unconnected-element',
          severity: 'warning',
          message: 'Element is unreachable.',
          path: 'assignments/Set_Total',
        },
        {
          apiName: 'Order_Flow',
          namespace: 'managed',
          version: 7,
          check: 'versions',
          code: 'no-active-version',
          severity: 'error',
          message: 'No Flow version is active.',
          path: null,
        },
      ],
      errors: 1,
      warnings: 1,
      targetOrg: 'admin@example.com',
    };
    const sarif = formatFlowCheckSarif(result);
    expect(sarif).to.contain('"logicalLocations"');
    expect(sarif).to.contain('"fullyQualifiedName": "managed__Order_Flow:assignments/Set_Total"');
    expect(sarif.match(/"fullyQualifiedName": "managed__Order_Flow"/gu)).to.have.length(2);
    expect(formatFlowCheckHuman(result)).to.contain('ERROR\tmanaged__Order_Flow\tversions');
    expect(sarif).not.to.contain('"physicalLocation"');
  });
});
