/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowMetricsFailed } from '../errors/flow-errors.js';
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowDescribeRequest } from '../types/flow-inspection.js';
import type { FlowMetricsRequest, FlowMetricsResult } from '../types/flow-metrics.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../utils/flow-metrics-analysis.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDescribeService } from './flow-describe-service.js';

function describeRequest(request: FlowMetricsRequest): FlowDescribeRequest {
  return {
    ...request,
    sections: [],
  };
}

export class FlowMetricsService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async calculate(
    request: FlowMetricsRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowMetricsResult> {
    try {
      const described = await new FlowDescribeService(this.gateway).describe(describeRequest(request), progress);
      const flows = await Promise.all(
        described.flows.map(async (flow) => {
          progress('loading-metadata', `${flow.qualifiedName} v${flow.versionNumber} (metrics)`);
          return analyseFlowMetrics(await this.gateway.getVersionMetadata(flow.versionId), flow);
        })
      );
      progress('analysing-results', `${described.apiName} (${flows.length} Flow versions)`);
      return {
        apiName: described.apiName,
        namespace: described.namespace,
        requestedVersion: described.requestedVersion,
        resolvedVersion: described.resolvedVersion,
        subflowVersion: described.subflowVersion,
        recursive: described.recursive,
        maxDepth: described.maxDepth,
        totals: totalFlowMetrics(flows),
        referencedObjects: [...new Set(flows.flatMap((flow) => flow.referencedObjects))].sort(),
        flows,
        warnings: described.warnings,
        targetOrg: described.targetOrg,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow') && error.name !== 'FlowInspectionFailed') {
        throw error;
      }
      throw flowMetricsFailed(`Failed to calculate metrics for Flow "${request.apiName}".`, error);
    }
  }
}
