/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDependenciesResult, FlowDependency } from '../types/flow-analysis.js';

function target(dependency: FlowDependency): string {
  const name = dependency.name ?? dependency.componentId ?? 'unknown';
  const namespace = dependency.namespace === null ? '' : `${dependency.namespace}__`;
  return `${dependency.type ?? 'Unknown'}:${namespace}${name}`;
}

function source(dependency: FlowDependency): string {
  return dependency.sourceNamespace === null
    ? dependency.sourceApiName
    : `${dependency.sourceNamespace}__${dependency.sourceApiName}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function renderTable(result: FlowDependenciesResult): string {
  const header = ['Source Flow', 'Depth', 'Direction', 'Type', 'Namespace', 'Name', 'Component ID'].join('\t');
  const rows = result.dependencies.map((dependency) =>
    [
      source(dependency),
      dependency.depth,
      dependency.direction,
      dependency.type ?? '',
      dependency.namespace ?? '',
      dependency.name ?? '',
      dependency.componentId ?? '',
    ].join('\t')
  );
  return [header, ...rows].join('\n');
}

function renderTree(result: FlowDependenciesResult): string {
  return [
    result.apiName,
    ...result.dependencies.map(
      (dependency) => `${'  '.repeat(dependency.depth + 1)}${dependency.direction} ${target(dependency)}`
    ),
  ].join('\n');
}

function nodeId(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `n${hash.toString(16)}`;
}

function renderMermaid(result: FlowDependenciesResult): string {
  const lines = ['flowchart LR'];
  for (const dependency of result.dependencies) {
    const from = source(dependency);
    const to = target(dependency);
    const edge = dependency.direction === 'uses' ? '-->' : '<--';
    lines.push(`  ${nodeId(from)}["${escapeLabel(from)}"] ${edge} ${nodeId(to)}["${escapeLabel(to)}"]`);
  }
  return lines.join('\n');
}

function renderDot(result: FlowDependenciesResult): string {
  const lines = ['digraph FlowDependencies {', '  rankdir=LR;'];
  for (const dependency of result.dependencies) {
    const from = escapeLabel(source(dependency));
    const to = escapeLabel(target(dependency));
    const edge = dependency.direction === 'uses' ? `"${from}" -> "${to}";` : `"${to}" -> "${from}";`;
    lines.push(`  ${edge}`);
  }
  return [...lines, '}'].join('\n');
}

export function renderFlowDependencies(
  result: FlowDependenciesResult,
  format: 'table' | 'tree' | 'mermaid' | 'dot'
): string {
  if (format === 'tree') {
    return renderTree(result);
  }
  if (format === 'mermaid') {
    return renderMermaid(result);
  }
  return format === 'dot' ? renderDot(result) : renderTable(result);
}
