/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowCompareResult, FlowComparisonChange, JsonValue } from '../types/flow-analysis.js';
import { qualifiedFlowName } from './flow-state.js';

function value(input: JsonValue | undefined): string {
  return input === undefined ? '' : typeof input === 'string' ? input : JSON.stringify(input);
}

function markdownValue(input: JsonValue | undefined): string {
  return value(input).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function unifiedValue(input: JsonValue | undefined): string {
  return input === undefined ? '' : JSON.stringify(input);
}

function sideLabel(result: FlowCompareResult, side: 'from' | 'to'): string {
  const sourceFile = side === 'from' ? result.fromSourceFile : result.toSourceFile;
  if (sourceFile !== null) {
    return sourceFile;
  }
  const version = side === 'from' ? result.fromVersion : result.toVersion;
  const org = side === 'from' ? result.fromOrg : result.toOrg;
  return `v${String(version)} (${String(org)})`;
}

function sideReference(result: FlowCompareResult, side: 'from' | 'to'): string {
  const sourceFile = side === 'from' ? result.fromSourceFile : result.toSourceFile;
  const version = side === 'from' ? result.fromVersion : result.toVersion;
  return sourceFile ?? String(version);
}

function renderSummary(result: FlowCompareResult): string {
  const flowName = qualifiedFlowName(result.apiName, result.namespace);
  return [
    `Flow: ${flowName}`,
    `From: ${sideLabel(result, 'from')}`,
    `To: ${sideLabel(result, 'to')}`,
    `Changes: ${result.changes.length} (${result.added} added, ${result.removed} removed, ${result.changed} changed)`,
  ].join('\n');
}

function renderUnifiedChange(change: FlowComparisonChange): string[] {
  return [`@@ ${change.path} @@`, `- ${unifiedValue(change.before)}`, `+ ${unifiedValue(change.after)}`];
}

function renderUnified(result: FlowCompareResult): string {
  const flowName = qualifiedFlowName(result.apiName, result.namespace);
  const header = [`--- ${flowName}@${sideReference(result, 'from')}`, `+++ ${flowName}@${sideReference(result, 'to')}`];
  return [...header, ...result.changes.flatMap(renderUnifiedChange)].join('\n');
}

function renderMarkdown(result: FlowCompareResult): string {
  const flowName = qualifiedFlowName(result.apiName, result.namespace);
  const rows = result.changes.map(
    (change) =>
      `| ${change.kind} | \`${change.path}\` | ${markdownValue(change.before)} | ${markdownValue(change.after)} |`
  );
  return [
    `# Flow comparison: ${flowName}`,
    '',
    `${sideLabel(result, 'from')} → ${sideLabel(result, 'to')}.`,
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
