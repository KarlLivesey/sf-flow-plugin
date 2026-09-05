/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowComparisonChange, FlowComparisonVersionSelector } from './flow-analysis.js';

export interface FlowSnapshotEntry {
  apiName: string;
  namespace: string | null;
  version: number;
  status: string;
  file: string;
  sha256: string;
}

export interface FlowSnapshotResult {
  schemaVersion: 1;
  createdAt: string;
  targetOrg: string;
  versionSelector: FlowComparisonVersionSelector;
  selection: { apiNames: string[]; namespace: string | null };
  flows: FlowSnapshotEntry[];
}

export interface FlowDriftResult {
  snapshotOrg: string;
  targetOrg: string;
  different: boolean;
  flows: Array<{ flow: string; kind: 'added' | 'missing' | 'changed' | 'unchanged'; changes: FlowComparisonChange[] }>;
}
