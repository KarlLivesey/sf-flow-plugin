/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { AsyncTaskLimiter } from '../../src/utils/async-task-limiter.js';

describe('AsyncTaskLimiter', (): void => {
  it('shares one concurrency budget across callers', async (): Promise<void> => {
    const limiter = new AsyncTaskLimiter(3);
    let active = 0;
    let maximumActive = 0;
    await Promise.all(
      Array.from({ length: 12 }, async (_, index) =>
        limiter.run(async () => {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise((resolve) => {
            setImmediate(resolve);
          });
          active -= 1;
          return index;
        })
      )
    );
    expect(maximumActive).to.equal(3);
  });

  it('releases capacity after a task rejects', async (): Promise<void> => {
    const limiter = new AsyncTaskLimiter(1);
    try {
      await limiter.run(async () => {
        throw new Error('failed');
      });
      expect.fail('Expected the first task to fail.');
    } catch (error: unknown) {
      expect((error as Error).message).to.equal('failed');
    }
    expect(await limiter.run(async () => 'completed')).to.equal('completed');
  });
});
