/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowBundleExternalDependency, FlowBundleVersion } from '../types/flow-bundle.js';

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function renderPackageXml(flows: ReadonlyArray<FlowBundleVersion>, apiVersion: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
    '    <types>',
    ...flows.map((flow) => `        <members>${escapeXml(flow.qualifiedName)}</members>`),
    '        <name>Flow</name>',
    '    </types>',
    `    <version>${escapeXml(apiVersion)}</version>`,
    '</Package>',
    '',
  ].join('\n');
}

export function externalDependencies(
  dependencies: ReadonlyArray<{ name: string | null; namespace: string | null; type: string | null }>
): FlowBundleExternalDependency[] {
  const values = dependencies
    .filter(
      (dependency): dependency is FlowBundleExternalDependency =>
        dependency.type !== null && dependency.type !== 'Flow' && dependency.name !== null
    )
    .map((dependency) => {
      const value: FlowBundleExternalDependency = {
        name: dependency.name,
        namespace: dependency.namespace,
        type: dependency.type,
      };
      return [`${value.type}\u0000${value.namespace ?? ''}\u0000${value.name}`, value] as const;
    });
  return [...new Map(values).values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      (left.namespace ?? '').localeCompare(right.namespace ?? '') ||
      left.name.localeCompare(right.name)
  );
}
