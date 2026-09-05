/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Spinner } from '@salesforce/sf-plugins-core';
import { expect } from 'chai';

import { withFlowProgress } from '../../src/utils/flow-progress.js';

function fakeSpinner(events: string[]): Spinner {
  return {
    set status(value: string | undefined) {
      events.push(`status:${value ?? ''}`);
    },
    start: (action: string): void => {
      events.push(`start:${action}`);
    },
    stop: (): void => {
      events.push('stop');
    },
  } as Spinner;
}

describe('withFlowProgress', (): void => {
  it('starts and stops progress around a successful operation', async (): Promise<void> => {
    const events: string[] = [];
    const result = await withFlowProgress(fakeSpinner(events), 'graph', async (progress) => {
      progress('loading-metadata', 'Order_Processing v3');
      progress('rendering-graph');
      return Promise.resolve('result');
    });
    expect(result).to.equal('result');
    expect(events).to.deep.equal([
      'start:Generating Flow graph',
      'status:Loading Flow metadata: Order_Processing v3',
      'status:Rendering graph',
      'stop',
    ]);
  });

  it('stops progress when the operation fails', async (): Promise<void> => {
    const events: string[] = [];
    try {
      await withFlowProgress(fakeSpinner(events), 'prune', async () => Promise.reject(new Error('failure')));
      expect.fail('Expected progress operation to fail.');
    } catch (error) {
      expect(error).to.be.instanceOf(Error);
    }
    expect(events).to.deep.equal(['start:Pruning Flow versions', 'stop']);
  });
});
