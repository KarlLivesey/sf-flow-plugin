/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { flowCodeAnalyzerFailed, flowCodeAnalyzerUnavailable } from '../errors/flow-errors.js';
import type { FlowLintFinding, FlowLintLocation } from '../types/flow-lint.js';
import { createFlowLintFingerprint } from '../utils/flow-lint-fingerprint.js';

const CODE_ANALYZER_PLUGIN = '@salesforce/plugin-code-analyzer';
const MAX_PROCESS_OUTPUT_BYTES = 5 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const analyzerLocationSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
});

const analyzerViolationSchema = z.object({
  rule: z.string().min(1),
  engine: z.literal('flow'),
  severity: z.number().int().min(1).max(5),
  tags: z.array(z.string()),
  primaryLocationIndex: z.number().int().nonnegative(),
  locations: z.array(analyzerLocationSchema).min(1),
  message: z.string().min(1),
});

const analyzerResultSchema = z.object({
  runDir: z.string().min(1),
  violations: z.array(analyzerViolationSchema),
});

export interface CodeAnalyzerProcessRunner {
  run(args: ReadonlyArray<string>, cwd: string): Promise<{ stdout: string }>;
}

class SfCodeAnalyzerProcessRunner implements CodeAnalyzerProcessRunner {
  public constructor(private readonly executable = 'sf') {}

  public async run(args: ReadonlyArray<string>, cwd: string): Promise<{ stdout: string }> {
    const result = await execFileAsync(this.executable, [...args], {
      cwd,
      encoding: 'utf8',
      maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
      windowsHide: true,
    });
    return { stdout: result.stdout };
  }
}

export interface FlowCodeAnalyzerRequest {
  sourceFile: string;
  rules: string[];
  excludedRules: string[];
}

function analyzerRuleSelectors(rules: ReadonlyArray<string>): string[] {
  return (rules.length === 0 ? ['flow'] : rules).map((rule) =>
    rule === 'flow' || rule.startsWith('flow:') ? rule : `flow:${rule}`
  );
}

function analyzerArguments(request: FlowCodeAnalyzerRequest, outputFile: string): string[] {
  return [
    'code-analyzer',
    'run',
    ...analyzerRuleSelectors(request.rules).flatMap((rule) => ['--rule-selector', rule]),
    '--workspace',
    request.sourceFile,
    '--target',
    request.sourceFile,
    '--output-file',
    outputFile,
  ];
}

function lintLocations(
  runDir: string,
  locations: Array<z.infer<typeof analyzerLocationSchema>>,
  primaryLocationIndex: number
): FlowLintLocation[] {
  return locations.map((location, index) => ({
    file: resolve(runDir, location.file),
    startLine: location.startLine,
    startColumn: location.startColumn,
    endLine: location.endLine ?? null,
    endColumn: location.endColumn ?? null,
    primary: index === primaryLocationIndex,
  }));
}

function lintFinding(runDir: string, violation: z.infer<typeof analyzerViolationSchema>): FlowLintFinding {
  const locations = lintLocations(runDir, violation.locations, violation.primaryLocationIndex);
  const primary = locations.find((location) => location.primary) ?? locations[0];
  const path = primary === undefined ? null : `line ${primary.startLine}:${primary.startColumn}`;
  return {
    fingerprint: createFlowLintFingerprint({
      rule: violation.rule,
      ...(path === null ? {} : { path }),
      evidence: [violation.message],
    }),
    rule: violation.rule,
    severity: violation.severity <= 2 ? 'error' : 'warning',
    message: violation.message,
    element: null,
    path,
    analyzerSeverity: violation.severity,
    tags: violation.tags,
    locations,
  };
}

function compareFindings(left: FlowLintFinding, right: FlowLintFinding): number {
  const leftLocation = left.locations?.find((location) => location.primary);
  const rightLocation = right.locations?.find((location) => location.primary);
  return (
    left.rule.localeCompare(right.rule) ||
    (leftLocation?.file ?? '').localeCompare(rightLocation?.file ?? '') ||
    (leftLocation?.startLine ?? 0) - (rightLocation?.startLine ?? 0) ||
    (leftLocation?.startColumn ?? 0) - (rightLocation?.startColumn ?? 0) ||
    left.message.localeCompare(right.message)
  );
}

async function readAnalyzerFindings(
  outputFile: string,
  excludedRules: ReadonlyArray<string>
): Promise<FlowLintFinding[]> {
  let parsed: z.infer<typeof analyzerResultSchema>;
  try {
    parsed = analyzerResultSchema.parse(JSON.parse(await readFile(outputFile, 'utf8')) as unknown);
  } catch {
    throw flowCodeAnalyzerFailed('Salesforce Code Analyzer returned an invalid Flow Scanner result.');
  }
  const excluded = new Set(excludedRules);
  return parsed.violations
    .filter((violation) => !excluded.has(violation.rule))
    .map((violation) => lintFinding(parsed.runDir, violation))
    .sort(compareFindings);
}

export class SalesforceCodeAnalyzerFlowService {
  public constructor(
    private readonly runner: CodeAnalyzerProcessRunner = new SfCodeAnalyzerProcessRunner(),
    private readonly cwd = process.cwd()
  ) {}

  public async isInstalled(): Promise<boolean> {
    try {
      const result = await this.runner.run(['plugins', '--core'], this.cwd);
      return /^(?:@salesforce\/plugin-)?code-analyzer\s+/mu.test(result.stdout);
    } catch {
      return false;
    }
  }

  public async install(): Promise<void> {
    try {
      await this.runner.run(['plugins', 'install', CODE_ANALYZER_PLUGIN], this.cwd);
    } catch {
      throw flowCodeAnalyzerUnavailable();
    }
  }

  public async analyse(request: FlowCodeAnalyzerRequest): Promise<FlowLintFinding[]> {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'sf-flow-code-analyzer-'));
    const outputFile = join(temporaryDirectory, 'flow-results.json');
    try {
      await this.runner.run(analyzerArguments(request, outputFile), this.cwd);
      return await readAnalyzerFindings(outputFile, request.excludedRules);
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('FlowCodeAnalyzer')) {
        throw error;
      }
      throw flowCodeAnalyzerFailed('Salesforce Code Analyzer could not analyse the local Flow source file.');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

export interface CodeAnalyzerInstallConsent {
  canPrompt: boolean;
  noPrompt: boolean;
  confirm(): Promise<boolean>;
}

export async function ensureSalesforceCodeAnalyzer(
  service: SalesforceCodeAnalyzerFlowService,
  consent: CodeAnalyzerInstallConsent
): Promise<void> {
  if (await service.isInstalled()) {
    return;
  }
  if (consent.noPrompt || !consent.canPrompt || !(await consent.confirm())) {
    throw flowCodeAnalyzerUnavailable();
  }
  await service.install();
  if (!(await service.isInstalled())) {
    throw flowCodeAnalyzerUnavailable();
  }
}
