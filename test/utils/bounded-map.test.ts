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

describe('boundedMap edge cases', (): void => {
  it('processes undefined inputs and preserves undefined results', async (): Promise<void> => {
    const results = await boundedMap([undefined, 1, undefined, 2], 2, async (value) => value);
    expect(results).to.deep.equal([undefined, 1, undefined, 2]);
  });

  it('waits for active workers and stops scheduling after a failure', async (): Promise<void> => {
    const started: number[] = [];
    let secondSettled = false;
    try {
      await boundedMap([1, 2, 3], 2, async (value): Promise<number> => {
        started.push(value);
        if (value === 1) {
          throw new Error('failed');
        }
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
        secondSettled = true;
        return value;
      });
      expect.fail('Expected boundedMap to reject a worker failure.');
    } catch (error: unknown) {
      expect((error as Error).message).to.equal('failed');
    }
    expect(secondSettled).to.equal(true);
    expect(started).to.deep.equal([1, 2]);
  });
});
