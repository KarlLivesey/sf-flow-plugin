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
import type { FlowDescribeRequest, FlowDescribeResult, FlowDescription } from '../types/flow-inspection.js';
import type { FlowLintResult } from '../types/flow-lint.js';
import type { FlowMetricsResult } from '../types/flow-metrics.js';
import {
  dependencyCheckFindings,
  createFlowCheckEntry,
  flowCheckLintRules,
  selectedFlowChecks,
  traversalCheckFindings,
  versionCheckFindings,
} from '../utils/flow-check-analysis.js';
import {
  type ResolvedCheckFlow,
  requiresFlowDescription,
  resolveFlowCheckRoot,
} from '../utils/flow-check-resolution.js';
import { AsyncTaskLimiter } from '../utils/async-task-limiter.js';
import { boundedMap } from '../utils/bounded-map.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { CachingFlowMetadataGateway } from './caching-flow-metadata-gateway.js';
import { FlowDependenciesService } from './flow-dependencies-service.js';
import { FlowDescribeService } from './flow-describe-service.js';
import { FlowLintService } from './flow-lint-service.js';
import { calculateResolvedFlowMetrics } from './flow-metrics-service.js';
import { FlowVersionsService } from './flow-versions-service.js';

type FlowCheckGateway = FlowDefinitionGateway & FlowDependencyGateway & FlowMetadataGateway;
const FLOW_LINT_CONCURRENCY = 4;

interface FlowCheckContext {
  request: FlowCheckRequest;
  apiName: string;
  checks: FlowCheckKind[];
  progress: FlowProgressReporter;
}

interface LintCheckContext extends FlowCheckContext {
  root: ResolvedCheckFlow;
  flows: ReadonlyArray<FlowDescription>;
  metadataGateway: FlowMetadataGateway;
}

interface RunChecksContext extends FlowCheckContext {
  root: ResolvedCheckFlow;
  described: FlowDescribeResult | null;
  metadataGateway: FlowMetadataGateway;
}

interface CheckAnalyses {
  lintResults: FlowLintResult[];
  dependencyFindings: FlowCheckFinding[];
  versionFindings: FlowCheckFinding[];
  metrics: FlowMetricsResult | null;
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

function requireOrgVersion(version: number | null, apiName: string): number {
  if (version === null) {
    throw flowCheckFailed(`Org-backed Flow "${apiName}" resolved without a version number.`);
  }
  return version;
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
    const metadataGateway = new CachingFlowMetadataGateway(this.gateway);
    const described = requiresFlowDescription(checks)
      ? await new FlowDescribeService(this.gateway, metadataGateway).describe(
          {
            ...describeRequest(request, apiName),
            recursive: request.recursive && (hasCheck(checks, 'metrics') || hasCheck(checks, 'subflows')),
          },
          progress
        )
      : null;
    const root: ResolvedCheckFlow =
      described === null
        ? await resolveFlowCheckRoot(this.gateway, { request, apiName, progress })
        : {
            apiName: described.apiName,
            namespace: described.namespace,
            versionNumber: requireOrgVersion(described.resolvedVersion, described.apiName),
          };
    const descriptions = described?.flows ?? [];
    const analyses = await this.runChecks({ ...context, root, described, metadataGateway });
    const traversalFindings =
      described === null
        ? []
        : traversalCheckFindings(
            {
              apiName: described.apiName,
              namespace: described.namespace,
              version: requireOrgVersion(described.resolvedVersion, described.apiName),
            },
            described.warnings
          );
    return createFlowCheckEntry(checks, {
      root,
      descriptions,
      traversalFindings,
      ...analyses,
    });
  }

  private async runChecks(context: RunChecksContext): Promise<CheckAnalyses> {
    const lintResults = await this.lintFlows({
      ...context,
      flows: context.described?.flows ?? [],
    });
    const dependencyFindings = await this.checkDependencies(context);
    const versionFindings = await this.checkVersions(context);
    if (hasCheck(context.checks, 'metrics') && context.described === null) {
      throw flowCheckFailed('Flow metrics require a resolved Flow traversal.');
    }
    const metrics =
      hasCheck(context.checks, 'metrics') && context.described !== null
        ? await calculateResolvedFlowMetrics(context.described, context.metadataGateway, context.progress)
        : null;
    return { lintResults, dependencyFindings, versionFindings, metrics };
  }

  private async lintFlows(context: LintCheckContext): Promise<FlowLintResult[]> {
    const { request, checks, progress, root, flows, metadataGateway } = context;
    if (!hasCheck(checks, 'lint') && !hasCheck(checks, 'subflows')) {
      return [];
    }
    const selection = flowCheckLintRules(checks);
    const requestLimiter = new AsyncTaskLimiter(FLOW_LINT_CONCURRENCY);
    const lintTargets: Array<{ apiName: string; namespace: string | null; versionNumber: number }> =
      flows.length === 0
        ? [{ apiName: root.apiName, namespace: root.namespace, versionNumber: root.versionNumber }]
        : flows.map((flow) => ({
            apiName: flow.apiName,
            namespace: flow.namespace,
            versionNumber: requireOrgVersion(flow.versionNumber, flow.apiName),
          }));
    return boundedMap(lintTargets, FLOW_LINT_CONCURRENCY, async (flow) =>
      new FlowLintService(this.gateway, metadataGateway, requestLimiter).lint(
        {
          apiName: flow.apiName,
          targetOrg: request.targetOrg,
          version: flow.versionNumber,
          ...selection,
          ...(flow.namespace === null ? {} : { namespace: flow.namespace }),
        },
        progress
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
}
