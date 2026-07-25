/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import { flowGraphStyleSchema } from '../schemas/flow.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowGraphRequest, FlowGraphResult } from '../types/flow-inspection.js';
import { renderFlowGraph } from '../utils/flow-graph-renderer.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDescribeService } from './flow-describe-service.js';

export class FlowGraphService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async graph(
    request: FlowGraphRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowGraphResult> {
    const style = flowGraphStyleSchema.safeParse(request.style);
    if (!style.success) {
      throw flowInspectionFailed('The requested graph style is invalid.');
    }
    const described = await new FlowDescribeService(this.gateway).describe(request, progress);
    const options = {
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      style: style.data,
    };
    progress('rendering-graph', `${described.apiName} (${request.format})`);
    return {
      ...described,
      format: request.format,
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      style: style.data,
      graph: renderFlowGraph(described.flows, request.format, options),
    };
  }
}
