/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowCheckFailed } from '../errors/flow-errors.js';
import { nonnegativeIntegerSchema } from '../schemas/flow.js';
import type { FlowDependencyGateway, FlowMetadataGateway } from '../types/flow-analysis.js';
import type {
  FlowCheckEntry,
  FlowCheckFinding,
  FlowCheckKind,
  FlowCheckRequest,
  FlowCheckResult,
} from '../types/flow-check.js';
import type { FlowDefinitionGateway, FlowVersionsRequest } from '../types/flow.js';
import type { FlowDescribeRequest, FlowDescription } from '../types/flow-inspection.js';
import type { FlowLintResult, FlowLintRule } from '../types/flow-lint.js';
import type { FlowMetricsResult } from '../types/flow-metrics.js';
import {
  dependencyCheckFindings,
  flowContracts,
  lintCheckFindings,
  selectedFlowChecks,
  traversalCheckFindings,
  versionCheckFindings,
} from '../utils/flow-check-analysis.js';
import {
  type ResolvedCheckFlow,
  requiresFlowDescription,
  resolveFlowCheckRoot,
} from '../utils/flow-check-resolution.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDependenciesService } from './flow-dependencies-service.js';
import { FlowDescribeService } from './flow-describe-service.js';
import { FlowLintService } from './flow-lint-service.js';
import { FlowMetricsService } from './flow-metrics-service.js';
import { FlowVersionsService } from './flow-versions-service.js';

type FlowCheckGateway = FlowDefinitionGateway & FlowDependencyGateway & FlowMetadataGateway;

interface CheckData {
  root: ResolvedCheckFlow;
  descriptions: FlowDescription[];
  traversalFindings: FlowCheckFinding[];
  lintResults: FlowLintResult[];
  dependencyFindings: FlowCheckFinding[];
  versionFindings: FlowCheckFinding[];
  metrics: FlowMetricsResult | null;
}

interface FlowCheckContext {
  request: FlowCheckRequest;
  apiName: string;
  checks: FlowCheckKind[];
  progress: FlowProgressReporter;
}

function validateRequest(request: FlowCheckRequest, checks: ReadonlyArray<FlowCheckKind>): void {
  if (
    request.apiNames.length === 0 ||
    checks.length === 0 ||
    !nonnegativeIntegerSchema.safeParse(request.maxDepth).success
  ) {
    throw flowCheckFailed('At least one Flow, one check and a valid traversal depth are required.');
  }
}

function namedRequest(
  request: FlowCheckRequest,
  apiName: string
): { apiName: string; targetOrg: string; namespace?: string; apiVersion?: string } {
  return {
    apiName,
    targetOrg: request.targetOrg,
    ...(request.namespace === undefined ? {} : { namespace: request.namespace }),
    ...(request.apiVersion === undefined ? {} : { apiVersion: request.apiVersion }),
  };
}

function describeRequest(request: FlowCheckRequest, apiName: string): FlowDescribeRequest {
  return {
    ...namedRequest(request, apiName),
    version: request.version,
    subflowVersion: request.subflowVersion,
    recursive: request.recursive,
    maxDepth: request.maxDepth,
    sections: [],
  };
}

function versionsRequest(request: FlowCheckRequest, apiName: string): FlowVersionsRequest {
  return {
    ...namedRequest(request, apiName),
    statuses: [],
    sort: 'version',
    order: 'asc',
  };
}

function hasCheck(checks: ReadonlyArray<FlowCheckKind>, check: FlowCheckKind): boolean {
  return checks.includes(check);
}

function lintRules(checks: ReadonlyArray<FlowCheckKind>): {
  rules: FlowLintRule[];
  excludedRules: FlowLintRule[];
} {
  const subflowRules: FlowLintRule[] = ['inactive-subflow', 'missing-subflow'];
  if (!hasCheck(checks, 'lint')) {
    return { rules: subflowRules, excludedRules: [] };
  }
  return hasCheck(checks, 'subflows') ? { rules: [], excludedRules: [] } : { rules: [], excludedRules: subflowRules };
}

function entryFindings(checks: ReadonlyArray<FlowCheckKind>, data: CheckData): FlowCheckFinding[] {
  return [
    ...(hasCheck(checks, 'lint') ? data.lintResults.flatMap((result) => lintCheckFindings(result, 'lint')) : []),
    ...(hasCheck(checks, 'subflows')
      ? [...data.lintResults.flatMap((result) => lintCheckFindings(result, 'subflows')), ...data.traversalFindings]
      : []),
    ...(hasCheck(checks, 'dependencies') ? data.dependencyFindings : []),
    ...(hasCheck(checks, 'versions') ? data.versionFindings : []),
  ];
}

function createEntry(checks: FlowCheckKind[], data: CheckData): FlowCheckEntry {
  const findings = entryFindings(checks, data);
  return {
    apiName: data.root.apiName,
    namespace: data.root.namespace,
    resolvedVersion: data.root.versionNumber,
    checks,
    contracts: flowContracts(data.descriptions),
    metrics: data.metrics,
    findings,
    errors: findings.filter((item) => item.severity === 'error').length,
    warnings: findings.filter((item) => item.severity === 'warning').length,
  };
}

export class FlowCheckService {
  public constructor(private readonly gateway: FlowCheckGateway) {}

  public async check(
    request: FlowCheckRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowCheckResult> {
    const checks = selectedFlowChecks(request.checks, request.excludedChecks);
    validateRequest(request, checks);
    try {
      const flows = await request.apiNames.reduce(async (previous, apiName) => {
        const entries = await previous;
        return [...entries, await this.checkFlow({ request, apiName, checks, progress })];
      }, Promise.resolve([] as FlowCheckEntry[]));
      const findings = flows.flatMap((flow) => flow.findings);
      return {
        apiNames: request.apiNames,
        requestedVersion: request.version,
        subflowVersion: request.subflowVersion,
        checks,
        excludedChecks: request.excludedChecks,
        recursive: request.recursive,
        maxDepth: request.maxDepth,
        allowTruncated: request.allowTruncated,
        flows,
        findings,
        errors: findings.filter((item) => item.severity === 'error').length,
        warnings: findings.filter((item) => item.severity === 'warning').length,
        targetOrg: request.targetOrg,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow') && error.name !== 'FlowInspectionFailed') {
        throw error;
      }
      throw flowCheckFailed('Flow checks could not be completed.', error);
    }
  }

  private async checkFlow(context: FlowCheckContext): Promise<FlowCheckEntry> {
    const { request, apiName, checks, progress } = context;
    const described = requiresFlowDescription(checks)
      ? await new FlowDescribeService(this.gateway).describe(describeRequest(request, apiName), progress)
      : null;
    const root =
      described === null
        ? await resolveFlowCheckRoot(this.gateway, { request, apiName, progress })
        : { apiName: described.apiName, namespace: described.namespace, versionNumber: described.resolvedVersion };
    const descriptions = described?.flows ?? [];
    const [lintResults, dependencyFindings, versionFindings, metrics] = await Promise.all([
      this.lintFlows(context, root, descriptions),
      this.checkDependencies(context),
      this.checkVersions(context),
      this.calculateMetrics(context),
    ]);
    const traversalFindings =
      described === null
        ? []
        : traversalCheckFindings(
            { apiName: described.apiName, namespace: described.namespace, version: described.resolvedVersion },
            described.warnings
          );
    return createEntry(checks, {
      root,
      descriptions,
      traversalFindings,
      lintResults,
      dependencyFindings,
      versionFindings,
      metrics,
    });
  }

  private async lintFlows(
    context: FlowCheckContext,
    root: ResolvedCheckFlow,
    flows: ReadonlyArray<FlowDescription>
  ): Promise<FlowLintResult[]> {
    const { request, checks, progress } = context;
    if (!hasCheck(checks, 'lint') && !hasCheck(checks, 'subflows')) {
      return [];
    }
    const selection = lintRules(checks);
    const lintTargets =
      flows.length === 0
        ? [{ apiName: root.apiName, namespace: root.namespace, versionNumber: root.versionNumber }]
        : flows;
    return Promise.all(
      lintTargets.map(async (flow) =>
        new FlowLintService(this.gateway).lint(
          {
            apiName: flow.apiName,
            targetOrg: request.targetOrg,
            version: flow.versionNumber,
            ...selection,
            ...(flow.namespace === null ? {} : { namespace: flow.namespace }),
          },
          progress
        )
      )
    );
  }

  private async checkDependencies(context: FlowCheckContext): Promise<FlowCheckFinding[]> {
    const { request, apiName, checks, progress } = context;
    if (!hasCheck(checks, 'dependencies')) {
      return [];
    }
    const result = await new FlowDependenciesService(this.gateway).getDependencies(
      {
        ...namedRequest(request, apiName),
        direction: 'both',
        recursive: request.recursive,
        maxDepth: request.maxDepth,
        types: [],
        excludeTypes: [],
      },
      progress
    );
    return dependencyCheckFindings(result, request.allowTruncated);
  }

  private async checkVersions(context: FlowCheckContext): Promise<FlowCheckFinding[]> {
    const { request, apiName, checks, progress } = context;
    return hasCheck(checks, 'versions')
      ? versionCheckFindings(
          await new FlowVersionsService(this.gateway).getVersions(versionsRequest(request, apiName), progress)
        )
      : [];
  }

  private async calculateMetrics(context: FlowCheckContext): Promise<FlowMetricsResult | null> {
    const { request, apiName, checks, progress } = context;
    if (!hasCheck(checks, 'metrics')) {
      return null;
    }
    const metrics = await new FlowMetricsService(this.gateway).calculate(
      { ...describeRequest(request, apiName), dataCloud: false, dataCloudDays: 30 },
      progress
    );
    const { dataCloud: _dataCloud, ...staticMetrics } = metrics;
    void _dataCloud;
    return staticMetrics;
  }
}
