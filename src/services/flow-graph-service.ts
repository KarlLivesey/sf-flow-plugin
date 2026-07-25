/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import { flowInspectionFailed } from '../errors/flow-errors.js';
import {
  flowGraphCurveSchema,
  flowGraphDirectionSchema,
  flowGraphLabelWidthSchema,
  flowGraphLayoutSchema,
  flowGraphStyleSchema,
} from '../schemas/flow.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowGraphRequest, FlowGraphResult } from '../types/flow-inspection.js';
import { renderFlowGraph } from '../utils/flow-graph-renderer.js';
import { resolveGraphCurve, resolveGraphDirection, resolveGraphLayout } from '../utils/flow-graph-renderer-model.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDescribeService } from './flow-describe-service.js';

function validateGraphOptions(
  request: FlowGraphRequest
): Pick<FlowGraphRequest, 'curve' | 'direction' | 'layout' | 'style'> {
  const style = flowGraphStyleSchema.safeParse(request.style);
  const direction = flowGraphDirectionSchema.safeParse(request.direction);
  const layout = flowGraphLayoutSchema.safeParse(request.layout);
  const curve = flowGraphCurveSchema.safeParse(request.curve);
  if (
    !style.success ||
    !direction.success ||
    !layout.success ||
    !curve.success ||
    !flowGraphLabelWidthSchema.safeParse(request.labelWidth).success
  ) {
    throw flowInspectionFailed('The requested graph rendering options are invalid.');
  }
  return { style: style.data, direction: direction.data, layout: layout.data, curve: curve.data };
}

export class FlowGraphService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway) {}

  public async graph(
    request: FlowGraphRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowGraphResult> {
    const validated = validateGraphOptions(request);
    const described = await new FlowDescribeService(this.gateway).describe(request, progress);
    const resolvedDirection = resolveGraphDirection(described.flows, validated.direction);
    const resolvedLayout = resolveGraphLayout(described.flows, validated.layout);
    const resolvedCurve = resolveGraphCurve(validated.curve, resolvedLayout);
    const options = {
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      direction: resolvedDirection,
      layout: resolvedLayout,
      curve: resolvedCurve,
      legend: request.legend,
      labelWidth: request.labelWidth,
      style: validated.style,
    };
    progress('rendering-graph', `${described.apiName} (${request.format})`);
    return {
      ...described,
      format: request.format,
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      requestedDirection: validated.direction,
      resolvedDirection,
      requestedLayout: validated.layout,
      resolvedLayout,
      requestedCurve: validated.curve,
      resolvedCurve,
      legend: request.legend,
      labelWidth: request.labelWidth,
      style: validated.style,
      graph: renderFlowGraph(described.flows, request.format, options),
    };
  }
}
