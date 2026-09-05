/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { NamedFlowRequest, FlowVersionNumber } from './flow.js';

export interface FlowDeleteVersionRequest extends NamedFlowRequest {
  version: FlowVersionNumber;
  expectedActiveVersion?: FlowVersionNumber;
  expectedLatestVersion?: FlowVersionNumber;
  dryRun: boolean;
}

export interface FlowDeleteVersionPlan {
  action: 'delete-version';
  versionId: string;
  versionNumber: FlowVersionNumber;
  status: string;
  active: false;
  latest: false;
}

export interface FlowDeleteVersionResult {
  apiName: string;
  namespace: string | null;
  definitionId: string;
  activeVersion: FlowVersionNumber | null;
  latestVersion: FlowVersionNumber | null;
  expectedActiveVersion: FlowVersionNumber | null;
  expectedLatestVersion: FlowVersionNumber | null;
  plan: FlowDeleteVersionPlan;
  changed: boolean;
  dryRun: boolean;
  targetOrg: string;
}
