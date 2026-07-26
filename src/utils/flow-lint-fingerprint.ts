/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { createHash } from 'node:crypto';

import type { FlowLintFinding, FlowLintRule } from '../types/flow-lint.js';

export interface FlowLintFingerprintInput {
  rule: FlowLintRule;
  element?: string;
  path?: string;
  evidence?: ReadonlyArray<string>;
}

export function createFlowLintFingerprint(input: FlowLintFingerprintInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.rule, input.element ?? null, input.path ?? null, input.evidence ?? []]))
    .digest('hex');
}

export function legacyFlowLintFingerprint(finding: Omit<FlowLintFinding, 'fingerprint'>): string {
  const hardCodedId =
    finding.rule === 'hard-coded-id' ? finding.message.match(/[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?/) : null;
  return createFlowLintFingerprint({
    rule: finding.rule,
    ...(finding.element === null ? {} : { element: finding.element }),
    ...(finding.path === null ? {} : { path: finding.path }),
    ...(hardCodedId?.[0] === undefined ? {} : { evidence: [hardCodedId[0]] }),
  });
}
