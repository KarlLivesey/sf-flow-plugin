/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { flowLintFailed } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema } from '../schemas/flow.js';
import type { FlowLintDirectoryResult, FlowLintFinding, FlowLintResult } from '../types/flow-lint.js';
import { legacyFlowLintFingerprint } from './flow-lint-fingerprint.js';
import { analyzerFlowLintSarifLocations } from './flow-lint-sarif.js';
import type { FlowLintSarifLocation } from './flow-lint-sarif.js';
import { qualifiedFlowName } from './flow-state.js';

interface BaselineFinding {
  finding: FlowLintFinding;
  legacyMessageKey: string | null;
}

interface FlowLintBaseline {
  apiName: string;
  namespace: string | null;
  findings: BaselineFinding[];
}

function legacyMessageKey(finding: Omit<FlowLintFinding, 'fingerprint'>): string {
  return JSON.stringify([finding.rule, finding.element, finding.path, finding.message]);
}

const findingSchema = z
  .object({
    fingerprint: z
      .string()
      .regex(/^[\da-f]{64}$/u)
      .optional(),
    rule: z.string().min(1),
    severity: z.enum(['error', 'warning']),
    message: z.string(),
    element: z.string().nullable(),
    path: z.string().nullable(),
    analyzerSeverity: z.number().int().min(1).max(5).optional(),
    tags: z.array(z.string()).optional(),
    locations: z
      .array(
        z.object({
          file: z.string().min(1),
          startLine: z.number().int().positive(),
          startColumn: z.number().int().positive(),
          endLine: z.number().int().positive().nullable(),
          endColumn: z.number().int().positive().nullable(),
          primary: z.boolean(),
        })
      )
      .optional(),
  })
  .transform((finding): BaselineFinding => {
    const legacy = finding.fingerprint === undefined;
    const parsedFinding: Omit<FlowLintFinding, 'fingerprint'> = {
      rule: finding.rule,
      severity: finding.severity,
      message: finding.message,
      element: finding.element,
      path: finding.path,
      ...(finding.analyzerSeverity === undefined ? {} : { analyzerSeverity: finding.analyzerSeverity }),
      ...(finding.tags === undefined ? {} : { tags: finding.tags }),
      ...(finding.locations === undefined ? {} : { locations: finding.locations }),
    };
    return {
      finding: {
        ...parsedFinding,
        fingerprint: finding.fingerprint ?? legacyFlowLintFingerprint(parsedFinding),
      },
      legacyMessageKey: legacy ? legacyMessageKey(parsedFinding) : null,
    };
  });

// A complete result identity is required so a findings-only file cannot suppress another Flow's findings.
const scopedBaselineSchema: z.ZodType<FlowLintBaseline> = z.object({
  apiName: flowApiNameSchema,
  namespace: namespaceSchema.nullable(),
  findings: z.array(findingSchema),
});

const baselineSchema: z.ZodType<FlowLintBaseline> = z.union([
  scopedBaselineSchema,
  z
    .object({
      status: z.union([z.literal(0), z.literal(1)]),
      result: scopedBaselineSchema,
      warnings: z.array(z.unknown()),
    })
    .transform(({ result }) => result),
]);

function findingKey(finding: FlowLintFinding): string {
  return finding.fingerprint;
}

function classifyFindings(result: FlowLintResult, baseline: ReadonlyArray<BaselineFinding>): FlowLintResult {
  const known = new Set(baseline.map((entry) => findingKey(entry.finding)));
  const legacy = new Set(
    baseline.flatMap((entry) => (entry.legacyMessageKey === null ? [] : [entry.legacyMessageKey]))
  );
  const isKnown = (finding: FlowLintFinding): boolean =>
    known.has(findingKey(finding)) || legacy.has(legacyMessageKey(finding));
  const baselineFindings = result.findings.filter(isKnown);
  const newFindings = result.findings.filter((finding) => !isKnown(finding));
  return {
    ...result,
    newFindings,
    baselineFindings,
    newErrors: newFindings.filter((finding) => finding.severity === 'error').length,
    newWarnings: newFindings.filter((finding) => finding.severity === 'warning').length,
  };
}

function assertBaselineScope(result: FlowLintResult, baseline: FlowLintBaseline, file: string): void {
  if (baseline.apiName === result.apiName && baseline.namespace === result.namespace) {
    return;
  }
  throw flowLintFailed(
    `Flow lint baseline "${file}" is scoped to Flow "${qualifiedFlowName(
      baseline.apiName,
      baseline.namespace
    )}", not "${qualifiedFlowName(result.apiName, result.namespace)}".`
  );
}

async function readBaseline(file: string, result: FlowLintResult): Promise<BaselineFinding[]> {
  const resolved = resolve(file);
  let baseline: FlowLintBaseline;
  try {
    const content = await readFile(resolved, 'utf8');
    baseline = baselineSchema.parse(JSON.parse(content) as unknown);
  } catch (error: unknown) {
    throw flowLintFailed(`Could not read a valid Flow lint baseline from "${resolved}".`, error);
  }
  assertBaselineScope(result, baseline, resolved);
  return baseline.findings;
}

export async function applyFlowLintBaseline(
  result: FlowLintResult,
  baselineFile: string | undefined
): Promise<FlowLintResult> {
  return baselineFile === undefined ? result : classifyFindings(result, await readBaseline(baselineFile, result));
}

function findingLine(finding: FlowLintFinding): string {
  const location = finding.element ?? finding.path ?? '-';
  return `${finding.severity.toUpperCase()}\t${finding.rule}\t${location}\t${finding.message}`;
}

function section(title: string, findings: ReadonlyArray<FlowLintFinding>): string[] {
  return [title, ...findings.map(findingLine), ''];
}

export function formatFlowLintHuman(result: FlowLintResult): string {
  const version = result.resolvedVersion === null ? 'local source' : `v${result.resolvedVersion}`;
  const heading = `Flow lint: ${qualifiedFlowName(result.apiName, result.namespace)} ${version}`;
  return [
    heading,
    '='.repeat(heading.length),
    '',
    ...section(`New findings (${result.newFindings.length})`, result.newFindings),
    ...section(`Baseline findings (${result.baselineFindings.length})`, result.baselineFindings),
  ].join('\n');
}

export function formatFlowLintDirectoryHuman(result: FlowLintDirectoryResult): string {
  return result.flows.map(formatFlowLintHuman).join('\n\n');
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning';
  message: { text: string };
  baselineState: 'new' | 'unchanged';
  partialFingerprints: { 'sf-flow-plugin/v1': string };
  locations?: FlowLintSarifLocation[];
}

function metadataSarifLocation(
  flowName: string,
  finding: FlowLintFinding,
  sourceFile: string | undefined
): FlowLintSarifLocation | null {
  const location = finding.path ?? finding.element;
  if (location === null) {
    return null;
  }
  return {
    logicalLocations: [
      {
        name: location,
        fullyQualifiedName: `${flowName}:${location}`,
        kind: finding.path === null ? 'flowElement' : 'metadataPath',
      },
    ],
    ...(sourceFile === undefined
      ? {}
      : { physicalLocation: { artifactLocation: { uri: pathToFileURL(sourceFile).toString() } } }),
    ...(finding.path === null ? {} : { properties: { metadataPath: finding.path } }),
  };
}

function sarifLocations(
  flowName: string,
  finding: FlowLintFinding,
  sourceFile: string | undefined
): FlowLintSarifLocation[] {
  const analyzerLocations = analyzerFlowLintSarifLocations(flowName, finding);
  if (analyzerLocations.length > 0) {
    return analyzerLocations;
  }
  const location = metadataSarifLocation(flowName, finding, sourceFile);
  return location === null ? [] : [location];
}

interface SarifResultContext {
  flowName: string;
  baseline: ReadonlySet<string>;
  sourceFile: string | undefined;
}

function sarifResult(finding: FlowLintFinding, context: SarifResultContext): SarifResult {
  const locations = sarifLocations(context.flowName, finding, context.sourceFile);
  return {
    ruleId: finding.rule,
    level: finding.severity,
    message: { text: finding.message },
    baselineState: context.baseline.has(findingKey(finding)) ? 'unchanged' : 'new',
    partialFingerprints: { 'sf-flow-plugin/v1': finding.fingerprint },
    ...(locations.length === 0 ? {} : { locations }),
  };
}

function flowLintSarifRun(result: FlowLintResult): object {
  const baseline = new Set(result.baselineFindings.map(findingKey));
  const flowName = qualifiedFlowName(result.apiName, result.namespace);
  return {
    tool: {
      driver: {
        name: 'sf-flow-plugin',
        informationUri: 'https://github.com/KarlLivesey/sf-flow-plugin',
        rules: [...new Set(result.findings.map((finding) => finding.rule))].sort().map((id) => ({ id })),
      },
    },
    results: result.findings.map((finding) =>
      sarifResult(finding, { flowName, baseline, sourceFile: result.sourceFile })
    ),
  };
}

function sarifDocument(runs: object[]): string {
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs,
    },
    null,
    2
  );
}

export function formatFlowLintSarif(result: FlowLintResult): string {
  return sarifDocument([flowLintSarifRun(result)]);
}

export function formatFlowLintDirectorySarif(result: FlowLintDirectoryResult): string {
  return sarifDocument(result.flows.map(flowLintSarifRun));
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
