/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDescription, FlowGraphFormat } from '../types/flow-inspection.js';
import { renderDot } from './flow-graph-dot.js';
import { renderMermaid } from './flow-graph-mermaid.js';
import type { FlowGraphRenderOptions } from './flow-graph-renderer-model.js';

export function renderFlowGraph(
  flows: ReadonlyArray<FlowDescription>,
  format: FlowGraphFormat,
  options: FlowGraphRenderOptions
): string {
  return format === 'dot' ? renderDot(flows, options) : renderMermaid(flows, options);
}
