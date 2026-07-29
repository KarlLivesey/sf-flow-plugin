/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowSourceMetricsResult } from '../types/flow-metrics.js';
import type { FlowSource } from '../types/flow-source.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../utils/flow-metrics-analysis.js';
import type { TraversedFlowSource } from './flow-source-directory-service.js';

export interface FlowSourceMetricsTraversal {
  sources: ReadonlyArray<TraversedFlowSource>;
  warnings: FlowSourceMetricsResult['warnings'];
  recursive: boolean;
  maxDepth: number;
}

export function calculateFlowSourceMetrics(
  source: FlowSource,
  traversal: FlowSourceMetricsTraversal = {
    sources: [{ source, depth: 0 }],
    warnings: [],
    recursive: false,
    maxDepth: 0,
  }
): FlowSourceMetricsResult {
  const flows = traversal.sources.map(({ source: item, depth }) => ({
    ...analyseFlowMetrics(item.metadata, { ...item.description, depth }),
    version: null,
  }));
  return {
    apiName: source.apiName,
    namespace: source.namespace,
    requestedVersion: null,
    resolvedVersion: null,
    subflowVersion: 'active',
    recursive: traversal.recursive,
    maxDepth: traversal.maxDepth,
    totals: totalFlowMetrics(flows),
    referencedObjects: [...new Set(flows.flatMap((entry) => entry.referencedObjects))].sort(),
    flows,
    warnings: traversal.warnings,
    targetOrg: null,
    sourceFile: source.sourceFile,
  };
}
