/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { flowCodeAnalyzerFailed, flowCodeAnalyzerUnavailable } from '../errors/flow-errors.js';
import type { FlowLintFinding, FlowLintLocation } from '../types/flow-lint.js';
import { createFlowLintFingerprint } from '../utils/flow-lint-fingerprint.js';
import {
  cleanupAnalyzerTemporaryDirectory,
  defaultAnalyzerTemporaryDirectory,
  requiredAnalyzerTemporaryDirectory,
  type AnalyzerTemporaryDirectory,
} from './analyzer-temporary-directory.js';

const CODE_ANALYZER_PLUGIN = '@salesforce/plugin-code-analyzer';
const INSTALLED_PLUGIN_TYPES = new Set(['core', 'user', 'link']);

const analyzerLocationSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  startColumn: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  endColumn: z.number().int().positive().optional(),
});

const analyzerViolationSchema = z
  .object({
    rule: z.string().min(1),
    engine: z.literal('flow'),
    severity: z.number().int().min(1).max(5),
    tags: z.array(z.string()),
    primaryLocationIndex: z.number().int().nonnegative(),
    locations: z.array(analyzerLocationSchema).min(1),
    message: z.string().min(1),
  })
  .refine((violation) => violation.primaryLocationIndex < violation.locations.length, {
    message: 'primaryLocationIndex must identify a location.',
    path: ['primaryLocationIndex'],
  });

const analyzerResultSchema = z.object({
  runDir: z.string().min(1),
  violations: z.array(analyzerViolationSchema),
});

const installedPluginSchema = z
  .array(
    z
      .object({
        name: z.string().optional(),
        alias: z.string().optional(),
        type: z.string(),
      })
      .passthrough()
  )
  .transform((plugins) =>
    plugins.some(
      (plugin) =>
        INSTALLED_PLUGIN_TYPES.has(plugin.type) &&
        [plugin.name, plugin.alias].some((name) => name === CODE_ANALYZER_PLUGIN || name === 'code-analyzer')
    )
  );

export interface CodeAnalyzerProcessRunner {
  run(args: ReadonlyArray<string>, cwd: string): Promise<{ stdout: string }>;
}

class SfCodeAnalyzerProcessRunner implements CodeAnalyzerProcessRunner {
  public constructor(private readonly executable = 'sf') {}

  public async run(args: ReadonlyArray<string>, cwd: string): Promise<{ stdout: string }> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(this.executable, [...args], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.once('error', rejectPromise);
      child.once('close', (exitCode, signal) => {
        if (exitCode === 0) {
          resolvePromise({ stdout: Buffer.concat(stdoutChunks).toString('utf8') });
          return;
        }
        const reason = signal === null ? `exit code ${exitCode ?? 'unknown'}` : `signal ${signal}`;
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        rejectPromise(new Error(`Salesforce CLI process failed with ${reason}.${stderr === '' ? '' : ` ${stderr}`}`));
      });
    });
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
  const primary = locations[violation.primaryLocationIndex];
  if (primary === undefined) {
    throw flowCodeAnalyzerFailed('Salesforce Code Analyzer returned an invalid primary Flow location.');
  }
  const path = `line ${primary.startLine}:${primary.startColumn}`;
  return {
    fingerprint: createFlowLintFingerprint({
      rule: violation.rule,
      path,
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

function analyzerExecutionError(error: unknown): Error {
  return error instanceof Error && error.name.startsWith('FlowCodeAnalyzer')
    ? error
    : flowCodeAnalyzerFailed('Salesforce Code Analyzer could not analyse the local Flow source file.');
}

type AnalyzerAttempt = { findings: FlowLintFinding[]; error?: never } | { error: Error; findings?: never };

async function attemptAnalysis(context: {
  runner: CodeAnalyzerProcessRunner;
  cwd: string;
  request: FlowCodeAnalyzerRequest;
  outputFile: string;
}): Promise<AnalyzerAttempt> {
  try {
    await context.runner.run(analyzerArguments(context.request, context.outputFile), context.cwd);
    return { findings: await readAnalyzerFindings(context.outputFile, context.request.excludedRules) };
  } catch (error: unknown) {
    return { error: analyzerExecutionError(error) };
  }
}

function failedAnalysis(error: Error, cleaned: boolean, temporaryDirectory: string): Error {
  return cleaned
    ? error
    : flowCodeAnalyzerFailed(
        `${error.message} Temporary cleanup also failed; the retained directory is: ${temporaryDirectory}`
      );
}

export class SalesforceCodeAnalyzerFlowService {
  public constructor(
    private readonly runner: CodeAnalyzerProcessRunner = new SfCodeAnalyzerProcessRunner(),
    private readonly cwd = process.cwd(),
    private readonly temporaryDirectory: AnalyzerTemporaryDirectory = defaultAnalyzerTemporaryDirectory
  ) {}

  public async isInstalled(): Promise<boolean> {
    try {
      const result = await this.runner.run(['plugins', '--json'], this.cwd);
      return installedPluginSchema.parse(JSON.parse(result.stdout) as unknown);
    } catch {
      throw flowCodeAnalyzerFailed('Salesforce CLI could not inspect the installed plugin list.');
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
    const temporaryDirectory = await requiredAnalyzerTemporaryDirectory(() => this.temporaryDirectory.create());
    const outputFile = join(temporaryDirectory, 'flow-results.json');
    const analysis = await attemptAnalysis({ runner: this.runner, cwd: this.cwd, request, outputFile });
    const cleaned = await cleanupAnalyzerTemporaryDirectory(
      (directory) => this.temporaryDirectory.remove(directory),
      temporaryDirectory
    );
    if (analysis.error !== undefined) {
      throw failedAnalysis(analysis.error, cleaned, temporaryDirectory);
    }
    if (!cleaned) {
      throw flowCodeAnalyzerFailed(
        `Salesforce Code Analyzer completed, but its temporary directory could not be removed: ${temporaryDirectory}`
      );
    }
    return analysis.findings;
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
