/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import { flowLintFailed } from '../errors/flow-errors.js';
import type { FlowLintFinding, FlowLintResult } from '../types/flow-lint.js';
import { legacyFlowLintFingerprint } from './flow-lint-fingerprint.js';

const findingSchema = z
  .object({
    fingerprint: z
      .string()
      .regex(/^[\da-f]{64}$/u)
      .optional(),
    rule: z.enum([
      'dml-inside-loop',
      'hard-coded-id',
      'inactive-subflow',
      'missing-fault-path',
      'missing-subflow',
      'unconnected-element',
      'unused-resource',
    ]),
    severity: z.enum(['error', 'warning']),
    message: z.string(),
    element: z.string().nullable(),
    path: z.string().nullable(),
  })
  .transform(
    (finding): FlowLintFinding => ({
      ...finding,
      fingerprint: finding.fingerprint ?? legacyFlowLintFingerprint(finding),
    })
  );

const baselineSchema = z.union([
  z.array(findingSchema),
  z.object({ findings: z.array(findingSchema) }).transform((value) => value.findings),
]);

function findingKey(finding: FlowLintFinding): string {
  return finding.fingerprint;
}

function classifyFindings(result: FlowLintResult, baseline: ReadonlyArray<FlowLintFinding>): FlowLintResult {
  const known = new Set(baseline.map(findingKey));
  const baselineFindings = result.findings.filter((finding) => known.has(findingKey(finding)));
  const newFindings = result.findings.filter((finding) => !known.has(findingKey(finding)));
  return {
    ...result,
    newFindings,
    baselineFindings,
    newErrors: newFindings.filter((finding) => finding.severity === 'error').length,
    newWarnings: newFindings.filter((finding) => finding.severity === 'warning').length,
  };
}

async function readBaseline(file: string): Promise<FlowLintFinding[]> {
  const resolved = resolve(file);
  try {
    const content = await readFile(resolved, 'utf8');
    return baselineSchema.parse(JSON.parse(content) as unknown);
  } catch (error: unknown) {
    throw flowLintFailed(`Could not read a valid Flow lint baseline from "${resolved}".`, error);
  }
}

export async function applyFlowLintBaseline(
  result: FlowLintResult,
  baselineFile: string | undefined
): Promise<FlowLintResult> {
  return baselineFile === undefined ? result : classifyFindings(result, await readBaseline(baselineFile));
}

function findingLine(finding: FlowLintFinding): string {
  const location = finding.element ?? finding.path ?? '-';
  return `${finding.severity.toUpperCase()}\t${finding.rule}\t${location}\t${finding.message}`;
}

function section(title: string, findings: ReadonlyArray<FlowLintFinding>): string[] {
  return [title, ...findings.map(findingLine), ''];
}

export function formatFlowLintHuman(result: FlowLintResult): string {
  const heading = `Flow lint: ${result.apiName} v${result.resolvedVersion}`;
  return [
    heading,
    '='.repeat(heading.length),
    '',
    ...section(`New findings (${result.newFindings.length})`, result.newFindings),
    ...section(`Baseline findings (${result.baselineFindings.length})`, result.baselineFindings),
  ].join('\n');
}

interface SarifLocation {
  logicalLocations: Array<{
    name: string;
    fullyQualifiedName: string;
    kind: 'flowElement' | 'metadataPath';
  }>;
  properties?: { metadataPath: string };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning';
  message: { text: string };
  baselineState: 'new' | 'unchanged';
  partialFingerprints: { 'sf-flow-plugin/v1': string };
  locations?: SarifLocation[];
}

function sarifLocation(apiName: string, finding: FlowLintFinding): SarifLocation | null {
  const location = finding.path ?? finding.element;
  if (location === null) {
    return null;
  }
  return {
    logicalLocations: [
      {
        name: location,
        fullyQualifiedName: `${apiName}:${location}`,
        kind: finding.path === null ? 'flowElement' : 'metadataPath',
      },
    ],
    ...(finding.path === null ? {} : { properties: { metadataPath: finding.path } }),
  };
}

function sarifResult(apiName: string, finding: FlowLintFinding, baseline: ReadonlySet<string>): SarifResult {
  const location = sarifLocation(apiName, finding);
  return {
    ruleId: finding.rule,
    level: finding.severity,
    message: { text: finding.message },
    baselineState: baseline.has(findingKey(finding)) ? 'unchanged' : 'new',
    partialFingerprints: { 'sf-flow-plugin/v1': finding.fingerprint },
    ...(location === null ? {} : { locations: [location] }),
  };
}

export function formatFlowLintSarif(result: FlowLintResult): string {
  const baseline = new Set(result.baselineFindings.map(findingKey));
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'sf-flow-plugin',
              informationUri: 'https://github.com/KarlLivesey/sf-flow-plugin',
              rules: [...new Set(result.findings.map((finding) => finding.rule))].sort().map((id) => ({ id })),
            },
          },
          results: result.findings.map((finding) => sarifResult(result.apiName, finding, baseline)),
        },
      ],
    },
    null,
    2
  );
}

export async function writeFlowLintOutput(outputFile: string, content: string): Promise<string> {
  const resolved = resolve(outputFile);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${content}\n`, 'utf8');
    return resolved;
  } catch (error: unknown) {
    throw flowLintFailed(`Could not write Flow lint output to "${resolved}".`, error);
  }
}
