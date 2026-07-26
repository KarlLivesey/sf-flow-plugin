/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection, Org } from '@salesforce/core';

export function createCommandOrg(connection: Connection, username = 'admin@example.com'): Org {
  return {
    getConnection: (_apiVersion?: string): Connection => {
      void _apiVersion;
      return connection;
    },
    getUsername: (): string => username,
  } as unknown as Org;
}
