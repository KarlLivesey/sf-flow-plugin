/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
export async function boundedMap<Input, Output>(
  items: ReadonlyArray<Input>,
  concurrency: number,
  worker: (item: Input, index: number) => Promise<Output>
): Promise<Output[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive safe integer.');
  }
  const results = new Array<Output | undefined>(items.length);
  let nextIndex = 0;
  async function runWorker(): Promise<void> {
    const index = nextIndex;
    nextIndex += 1;
    const item = items[index];
    if (item === undefined) {
      return;
    }
    results[index] = await worker(item, index);
    await runWorker();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => runWorker()));
  return results.map((result, index) => {
    if (result === undefined) {
      throw new Error(`Bounded map did not produce a result for item ${index}.`);
    }
    return result;
  });
}
