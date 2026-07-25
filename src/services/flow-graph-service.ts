/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowGraphRequest, FlowGraphResult } from '../types/flow-inspection.js';
import { renderFlowGraph } from '../utils/flow-graph-renderer.js';
import { FlowDescribeService } from './flow-describe-service.js';

export class FlowGraphService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async graph(request: FlowGraphRequest): Promise<FlowGraphResult> {
    const described = await new FlowDescribeService(this.gateway).describe(request);
    const options = {
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
    };
    return {
      ...described,
      format: request.format,
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      graph: renderFlowGraph(described.flows, request.format, options),
    };
  }
}
