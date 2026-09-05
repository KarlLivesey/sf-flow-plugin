/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  flowActivationFailed,
  flowVersionInvalid,
  flowVersionNotActivatable,
  flowVersionNotFound,
} from '../errors/flow-errors.js';

import type { FlowVersion, FlowVersionSelector } from '../types/flow.js';

const ACTIVATABLE_STATUSES = new Set(['Active', 'Draft']);

function assertUniqueVersions(apiName: string, versions: ReadonlyArray<FlowVersion>): void {
  const versionNumbers = versions.map((version) => version.versionNumber);
  if (new Set(versionNumbers).size !== versionNumbers.length) {
    throw flowActivationFailed(`Salesforce returned duplicate version records for Flow "${apiName}".`);
  }
}

function selectVersion(
  apiName: string,
  selector: FlowVersionSelector,
  versions: ReadonlyArray<FlowVersion>
): FlowVersion {
  const activatableVersions = versions.filter((version) => ACTIVATABLE_STATUSES.has(version.status));
  const latestCandidates = activatableVersions.length === 0 ? versions : activatableVersions;
  const selected =
    selector === 'latest'
      ? latestCandidates.reduce<FlowVersion | undefined>(
          (current, version) =>
            current === undefined || version.versionNumber > current.versionNumber ? version : current,
          undefined
        )
      : versions.find((version) => version.versionNumber === selector);
  if (selected === undefined) {
    throw flowVersionNotFound(apiName, selector);
  }
  return selected;
}

export function resolveFlowVersion(
  apiName: string,
  selector: FlowVersionSelector,
  versions: ReadonlyArray<FlowVersion>
): FlowVersion {
  if (selector !== 'latest' && (!Number.isSafeInteger(selector) || selector <= 0)) {
    throw flowVersionInvalid(String(selector));
  }
  assertUniqueVersions(apiName, versions);
  const selected = selectVersion(apiName, selector, versions);
  if (!ACTIVATABLE_STATUSES.has(selected.status)) {
    throw flowVersionNotActivatable(apiName, selected.versionNumber, selected.status);
  }
  return selected;
}
