/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { boundedMap } from '../../src/utils/bounded-map.js';

describe('boundedMap', (): void => {
  it('preserves result order while limiting concurrent work', async (): Promise<void> => {
    let active = 0;
    let maximumActive = 0;
    const results = await boundedMap([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value): Promise<number> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      active -= 1;
      return value * 2;
    });
    expect(results).to.deep.equal([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(maximumActive).to.equal(3);
  });

  it('rejects an invalid concurrency limit', async (): Promise<void> => {
    try {
      await boundedMap([1], 0, async (value) => value);
      expect.fail('Expected boundedMap to reject an invalid concurrency limit.');
    } catch (error: unknown) {
      expect(error).to.be.instanceOf(RangeError);
    }
  });
});
