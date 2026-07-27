/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
const NO_FAILURE = Symbol('no failure');

class BoundedMapState<Input, Output> {
  private readonly completed: boolean[];
  private readonly results: Output[];
  private failure: unknown = NO_FAILURE;
  private nextIndex = 0;

  public constructor(
    private readonly items: ReadonlyArray<Input>,
    private readonly concurrency: number,
    private readonly worker: (item: Input, index: number) => Promise<Output>
  ) {
    this.completed = new Array<boolean>(items.length).fill(false);
    this.results = new Array<Output>(items.length);
  }

  public async run(): Promise<Output[]> {
    const workerCount = Math.min(this.concurrency, this.items.length);
    await Promise.all(Array.from({ length: workerCount }, async () => this.runWorker()));
    if (this.failure !== NO_FAILURE) {
      throw this.failure;
    }
    if (this.completed.some((value) => !value)) {
      throw new Error('Bounded map did not produce every result.');
    }
    return this.results;
  }

  private claimIndex(): number | null {
    if (this.failure !== NO_FAILURE || this.nextIndex >= this.items.length) {
      return null;
    }
    const index = this.nextIndex;
    this.nextIndex += 1;
    return index;
  }

  private async runWorker(): Promise<void> {
    const index = this.claimIndex();
    if (index === null) {
      return;
    }
    try {
      this.results[index] = await this.worker(this.items[index] as Input, index);
      this.completed[index] = true;
    } catch (error: unknown) {
      if (this.failure === NO_FAILURE) {
        this.failure = error;
      }
      return;
    }
    await this.runWorker();
  }
}

export async function boundedMap<Input, Output>(
  items: ReadonlyArray<Input>,
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>
): Promise<Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive safe integer.');
  }
  return new BoundedMapState(items, concurrency, worker).run();
}
