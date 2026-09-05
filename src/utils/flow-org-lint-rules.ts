/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowLintFailed } from '../errors/flow-errors.js';
import type { FlowLintRule } from '../types/flow-lint.js';

const orgLintRules: FlowLintRule[] = [
  'dml-inside-loop',
  'hard-coded-id',
  'inactive-subflow',
  'missing-fault-path',
  'missing-subflow',
  'unconnected-element',
  'unused-resource',
];

export function orgLintRule(value: string): FlowLintRule {
  const rule = orgLintRules.find((candidate) => candidate === value);
  if (rule === undefined) {
    throw flowLintFailed(`Org-backed Flow lint rule "${value}" is invalid. Valid rules: ${orgLintRules.join(', ')}.`);
  }
  return rule;
}
