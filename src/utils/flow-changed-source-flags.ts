/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Flags } from '@salesforce/sf-plugins-core';

export const changedSourceFlags = {
  'changed-since': Flags.string({
    dependsOn: ['source-dir'],
    summary: 'Analyse tracked Flow changes against this Git commit or ref.',
  }),
  'include-callers': Flags.boolean({
    dependsOn: ['changed-since'],
    summary: 'Also analyse transitive callers of changed or deleted Flows.',
  }),
};
