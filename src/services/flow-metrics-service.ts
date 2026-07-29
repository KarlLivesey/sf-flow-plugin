/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowMetricsFailed } from '../errors/flow-errors.js';
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowDescribeRequest, FlowDescribeResult } from '../types/flow-inspection.js';
import type {
  FlowMetricsCommandResult,
  FlowMetricEntry,
  FlowMetricsRequest,
  FlowMetricsResult,
  FlowRuntimeMetrics,
  FlowRuntimeMetricsGateway,
} from '../types/flow-metrics.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../utils/flow-metrics-analysis.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { CachingFlowMetadataGateway } from './caching-flow-metadata-gateway.js';
import { FlowDescribeService } from './flow-describe-service.js';

interface ResolvedRuntimeFlow {
  apiName: string;
  namespace: string | null;
  version: number;
}

interface ResolvedMetricsTraversal {
  requestedVersion: FlowMetricsResult['requestedVersion'];
  resolvedVersion: number;
  targetOrg: string;
}

function describeRequest(request: FlowMetricsRequest): FlowDescribeRequest {
  return {
    ...request,
    sections: [],
  };
}

function resolvedRuntimeFlow(described: FlowDescribeResult): ResolvedRuntimeFlow {
  if (described.resolvedVersion === null) {
    throw flowMetricsFailed(`Org-backed Flow "${described.apiName}" resolved without a version number.`);
  }
  return {
    apiName: described.apiName,
    namespace: described.namespace,
    version: described.resolvedVersion,
  };
}

function resolvedMetricsTraversal(described: FlowDescribeResult): ResolvedMetricsTraversal {
  if (described.requestedVersion === null || described.resolvedVersion === null || described.targetOrg === null) {
    throw flowMetricsFailed(`Org-backed Flow "${described.apiName}" resolved without its org or version identity.`);
  }
  return {
    requestedVersion: described.requestedVersion,
    resolvedVersion: described.resolvedVersion,
    targetOrg: described.targetOrg,
  };
}

function orgMetricEntry(entry: ReturnType<typeof analyseFlowMetrics>): FlowMetricEntry {
  if (entry.version === null) {
    throw flowMetricsFailed(`Org-backed Flow "${entry.apiName}" resolved without a version number.`);
  }
  return { ...entry, version: entry.version };
}

function orgVersionId(flow: FlowDescribeResult['flows'][number]): string {
  if (flow.versionId === null) {
    throw flowMetricsFailed(`Org-backed Flow "${flow.apiName}" resolved without a version ID.`);
  }
  return flow.versionId;
}

export async function calculateResolvedFlowMetrics(
  described: FlowDescribeResult,
  metadataGateway: FlowMetadataGateway,
  progress: FlowProgressReporter = noFlowProgress
): Promise<FlowMetricsResult> {
  const resolved = resolvedMetricsTraversal(described);
  const flows = await Promise.all(
    described.flows.map(async (flow) => {
      progress('loading-metadata', `${flow.qualifiedName} v${flow.versionNumber} (metrics)`);
      return orgMetricEntry(analyseFlowMetrics(await metadataGateway.getVersionMetadata(orgVersionId(flow)), flow));
    })
  );
  progress('analysing-results', `${described.apiName} (${flows.length} Flow versions)`);
  return {
    apiName: described.apiName,
    namespace: described.namespace,
    requestedVersion: resolved.requestedVersion,
    resolvedVersion: resolved.resolvedVersion,
    subflowVersion: described.subflowVersion,
    recursive: described.recursive,
    maxDepth: described.maxDepth,
    totals: totalFlowMetrics(flows),
    referencedObjects: [...new Set(flows.flatMap((flow) => flow.referencedObjects))].sort(),
    flows,
    warnings: described.warnings,
    targetOrg: resolved.targetOrg,
  };
}

export class FlowMetricsService {
  public constructor(
    private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway,
    private readonly runtimeGateway?: FlowRuntimeMetricsGateway,
    private readonly sharedMetadataGateway?: FlowMetadataGateway
  ) {}

  public async calculate(
    request: FlowMetricsRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowMetricsCommandResult> {
    try {
      const metadataGateway = this.sharedMetadataGateway ?? new CachingFlowMetadataGateway(this.gateway);
      const described = await new FlowDescribeService(this.gateway, metadataGateway).describe(
        describeRequest(request),
        progress
      );
      const metrics = await calculateResolvedFlowMetrics(described, metadataGateway, progress);
      const dataCloud = await this.loadDataCloudMetrics(request, resolvedRuntimeFlow(described), progress);
      return {
        ...metrics,
        dataCloud,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow') && error.name !== 'FlowInspectionFailed') {
        throw error;
      }
      throw flowMetricsFailed(`Failed to calculate metrics for Flow "${request.apiName}".`, error);
    }
  }

  private async loadDataCloudMetrics(
    request: FlowMetricsRequest,
    resolved: ResolvedRuntimeFlow,
    progress: FlowProgressReporter
  ): Promise<FlowRuntimeMetrics | null> {
    if (!request.dataCloud) {
      return null;
    }
    if (this.runtimeGateway === undefined) {
      throw flowMetricsFailed('Data Cloud metrics were requested without a Data Cloud query gateway.');
    }
    progress(
      'loading-data-cloud-metrics',
      `${resolved.apiName} v${resolved.version} (last ${request.dataCloudDays} days)`
    );
    return this.runtimeGateway.getMetrics({
      apiName: resolved.apiName,
      namespace: resolved.namespace,
      version: resolved.version,
      windowDays: request.dataCloudDays,
    });
  }
}
