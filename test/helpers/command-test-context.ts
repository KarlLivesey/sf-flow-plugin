/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { TestContext } from '@salesforce/core/testSetup';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';

export const commandTestContext = new TestContext();
export let commandUx: ReturnType<typeof stubSfCommandUx>;

beforeEach((): void => {
  commandUx = stubSfCommandUx(commandTestContext.SANDBOX);
});

afterEach((): void => {
  commandTestContext.restore();
});
