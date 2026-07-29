/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowCodeAnalyzerFailed } from '../errors/flow-errors.js';
import type { FlowLintFinding } from '../types/flow-lint.js';
import type { FlowSource } from '../types/flow-source.js';

function primaryFile(finding: FlowLintFinding): string | undefined {
  return finding.locations?.find((location) => location.primary)?.file;
}

export function assignAnalyzerFindings(
  sources: ReadonlyArray<FlowSource>,
  findings: FlowLintFinding[]
): ReadonlyMap<string, FlowLintFinding[]> {
  const assigned = new Map(sources.map((source) => [source.sourceFile, [] as FlowLintFinding[]]));
  for (const finding of findings) {
    const file = primaryFile(finding);
    const sourceFindings = file === undefined ? undefined : assigned.get(file);
    if (sourceFindings === undefined) {
      throw flowCodeAnalyzerFailed(
        `Salesforce Code Analyzer finding "${finding.rule}" could not be assigned to a Flow source file.`
      );
    }
    sourceFindings.push(finding);
  }
  return assigned;
}
