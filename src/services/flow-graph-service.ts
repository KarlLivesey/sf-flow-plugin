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
  flowGraphElkOptionsSchema,
  flowGraphLabelWidthSchema,
  flowGraphLayoutSelectionSchema,
  flowGraphSpacingSchema,
  flowGraphStyleSchema,
} from '../schemas/flow.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowGraphRequest, FlowGraphResult } from '../types/flow-inspection.js';
import { renderFlowGraph } from '../utils/flow-graph-renderer.js';
import {
  resolveGraphCurve,
  resolveGraphDirection,
  resolveGraphElkOptions,
  resolveGraphLayout,
  resolveGraphLayoutCandidates,
} from '../utils/flow-graph-renderer-model.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDescribeService } from './flow-describe-service.js';

function summariseRequestedLayout(layout: FlowGraphRequest['layout']): FlowGraphResult['requestedLayout'] {
  if (!Array.isArray(layout)) {
    return layout;
  }
  return layout.length === 1 ? layout[0] ?? 'auto' : 'auto';
}

function validateGraphOptions(
  request: FlowGraphRequest
): Pick<FlowGraphRequest, 'curve' | 'direction' | 'elk' | 'layout' | 'nodeSpacing' | 'rankSpacing' | 'style'> {
  const style = flowGraphStyleSchema.safeParse(request.style);
  const direction = flowGraphDirectionSchema.safeParse(request.direction);
  const layout = flowGraphLayoutSelectionSchema.safeParse(request.layout);
  const curve = flowGraphCurveSchema.safeParse(request.curve);
  const elk = flowGraphElkOptionsSchema.safeParse(request.elk);
  const nodeSpacing = flowGraphSpacingSchema.safeParse(request.nodeSpacing);
  const rankSpacing = flowGraphSpacingSchema.safeParse(request.rankSpacing);
  if (
    !style.success ||
    !direction.success ||
    !layout.success ||
    !curve.success ||
    !elk.success ||
    !nodeSpacing.success ||
    !rankSpacing.success ||
    !flowGraphLabelWidthSchema.safeParse(request.labelWidth).success
  ) {
    throw flowInspectionFailed('The requested graph rendering options are invalid.');
  }
  return {
    style: style.data,
    direction: direction.data,
    layout: layout.data,
    curve: curve.data,
    elk: elk.data,
    nodeSpacing: nodeSpacing.data,
    rankSpacing: rankSpacing.data,
  };
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
    const layoutCandidates = resolveGraphLayoutCandidates(validated.layout);
    const resolvedLayout = resolveGraphLayout(described.flows, validated.layout, validated.elk);
    const resolvedCurve = resolveGraphCurve(validated.curve, resolvedLayout);
    const resolvedElk = resolveGraphElkOptions(described.flows, validated.elk);
    const options = {
      includeVariables: request.includeVariables,
      includeFormulas: request.includeFormulas,
      direction: resolvedDirection,
      layout: resolvedLayout,
      curve: resolvedCurve,
      elk: resolvedElk,
      nodeSpacing: validated.nodeSpacing,
      rankSpacing: validated.rankSpacing,
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
      requestedLayout: summariseRequestedLayout(validated.layout),
      layoutCandidates,
      resolvedLayout,
      requestedCurve: validated.curve,
      resolvedCurve,
      requestedElk: validated.elk,
      resolvedElk,
      nodeSpacing: validated.nodeSpacing,
      rankSpacing: validated.rankSpacing,
      legend: request.legend,
      labelWidth: request.labelWidth,
      style: validated.style,
      graph: renderFlowGraph(described.flows, request.format, options),
    };
  }
}
