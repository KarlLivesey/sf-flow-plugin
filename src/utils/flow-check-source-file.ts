/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowCheckFinding } from '../types/flow-check.js';

const sourceFiles = new WeakMap<FlowCheckFinding, string>();

export function assignFlowCheckSourceFile(finding: FlowCheckFinding, sourceFile: string): FlowCheckFinding {
  sourceFiles.set(finding, sourceFile);
  return finding;
}

export function flowCheckSourceFile(finding: FlowCheckFinding): string | undefined {
  return sourceFiles.get(finding);
}
