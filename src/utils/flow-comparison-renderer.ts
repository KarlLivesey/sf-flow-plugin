/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowCompareResult, FlowComparisonChange, JsonValue } from '../types/flow-analysis.js';

function value(input: JsonValue | undefined): string {
  return input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input);
}

function markdownValue(input: JsonValue | undefined): string {
  return value(input).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function unifiedValue(input: JsonValue | undefined): string {
  return input === undefined ? '' : JSON.stringify(input);
}

function renderSummary(result: FlowCompareResult): string {
  return [
    `Flow: ${result.apiName}`,
    `From: v${result.fromVersion} (${result.fromOrg})`,
    `To: v${result.toVersion} (${result.toOrg})`,
    `Changes: ${result.changes.length} (${result.added} added, ${result.removed} removed, ${result.changed} changed)`,
  ].join('\n');
}

function renderUnifiedChange(change: FlowComparisonChange): string[] {
  return [`@@ ${change.path} @@`, `- ${unifiedValue(change.before)}`, `+ ${unifiedValue(change.after)}`];
}

function renderUnified(result: FlowCompareResult): string {
  const header = [`--- ${result.apiName}@${result.fromVersion}`, `+++ ${result.apiName}@${result.toVersion}`];
  return [...header, ...result.changes.flatMap(renderUnifiedChange)].join('\n');
}

function renderMarkdown(result: FlowCompareResult): string {
  const rows = result.changes.map(
    (change) =>
      `| ${change.kind} | \`${change.path}\` | ${markdownValue(change.before)} | ${markdownValue(change.after)} |`
  );
  return [
    `# Flow comparison: ${result.apiName}`,
    '',
    `Version ${result.fromVersion} in ${result.fromOrg} → version ${result.toVersion} in ${result.toOrg}.`,
    '',
    '| Change | Path | Before | After |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

export function renderFlowComparison(result: FlowCompareResult, format: 'summary' | 'unified' | 'markdown'): string {
  if (format === 'unified') {
    return renderUnified(result);
  }
  return format === 'markdown' ? renderMarkdown(result) : renderSummary(result);
}
