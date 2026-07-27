/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowSortOrder, FlowVersionNumber } from './flow.js';

export interface FlowListRequest {
  targetOrg: string;
  apiNames: string[];
  types: string[];
  namespaces: string[];
  statuses: string[];
  sort: FlowListSort;
  order: FlowSortOrder;
  limit?: number;
}

export type FlowListSort = 'active-version' | 'api-name' | 'label' | 'latest-version' | 'modified' | 'type';

export interface FlowListEntry {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  label: string | null;
  processType: string | null;
  activeVersion: FlowVersionNumber | null;
  latestVersion: FlowVersionNumber | null;
  status: string | null;
  lastModifiedDate: string | null;
}

export interface FlowListResult {
  targetOrg: string;
  filters: {
    apiNames: string[];
    types: string[];
    namespaces: string[];
    statuses: string[];
  };
  sort: FlowListSort;
  order: FlowSortOrder;
  limit: number | null;
  definitions: FlowListEntry[];
}
