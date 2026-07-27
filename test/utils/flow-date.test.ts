/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import {
  isFlowVersionDateFilter,
  isSalesforceDateTime,
  parseFlowVersionDateFilter,
} from '../../src/utils/flow-date.js';

describe('Flow date parsing', (): void => {
  it('parses valid date-only filters at the start of the UTC day', (): void => {
    expect(parseFlowVersionDateFilter('2024-02-29')).to.equal(1_709_164_800_000);
    expect(isFlowVersionDateFilter('2024-02-29')).to.equal(true);
  });

  it('rejects impossible dates and datetimes', (): void => {
    expect(isFlowVersionDateFilter('2025-02-29')).to.equal(false);
    expect(isFlowVersionDateFilter('2026-04-31T12:00:00Z')).to.equal(false);
    expect(isSalesforceDateTime('2026-02-30T12:00:00Z')).to.equal(false);
  });
});
