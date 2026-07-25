/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import type { Spinner } from '@salesforce/sf-plugins-core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.progress');

export type FlowProgressAction =
  | 'activate'
  | 'audit'
  | 'compare'
  | 'deactivate'
  | 'dependencies'
  | 'describe'
  | 'graph'
  | 'prune'
  | 'versions';

export async function withFlowProgress<Result>(
  spinner: Spinner,
  action: FlowProgressAction,
  operation: () => Promise<Result>
): Promise<Result> {
  spinner.start(messages.getMessage(`actions.${action}`));
  try {
    return await operation();
  } finally {
    spinner.stop();
  }
}
