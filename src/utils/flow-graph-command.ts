/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { writeFile } from 'node:fs/promises';

import { flowGraphOptionsInvalid, flowInspectionFailed } from '../errors/flow-errors.js';
import { flowGraphColorRoleSchema, flowGraphColorSchema } from '../schemas/flow.js';
import type {
  FlowGraphColorOverrides,
  FlowGraphCurve,
  FlowGraphElkCycleBreaking,
  FlowGraphElkModelOrder,
  FlowGraphElkNodePlacement,
  FlowGraphFormat,
  FlowGraphLayout,
} from '../types/flow-inspection.js';

export interface FlowGraphFormatOptions {
  format: FlowGraphFormat;
  layout: FlowGraphLayout[];
  curve: FlowGraphCurve;
  nodePlacement: FlowGraphElkNodePlacement;
  modelOrder: FlowGraphElkModelOrder;
  cycleBreaking: FlowGraphElkCycleBreaking;
  mergeEdges: boolean;
  forceNodeOrder: boolean;
}

export function validateGraphFormatOptions(options: FlowGraphFormatOptions): void {
  const mermaidRouting =
    options.layout.some((layout) => layout !== 'auto') ||
    options.curve !== 'auto' ||
    options.nodePlacement !== 'auto' ||
    options.modelOrder !== 'auto' ||
    options.cycleBreaking !== 'auto' ||
    options.mergeEdges ||
    options.forceNodeOrder;
  if (options.format === 'dot' && mermaidRouting) {
    throw flowGraphOptionsInvalid('Mermaid routing flags cannot be used with DOT output.');
  }
}

export function parseGraphColorOverrides(values: ReadonlyArray<string>): FlowGraphColorOverrides {
  return values.reduce<FlowGraphColorOverrides>((colors, value) => {
    const separator = value.indexOf('=');
    const roleResult = flowGraphColorRoleSchema.safeParse(value.slice(0, separator));
    const colorResult = flowGraphColorSchema.safeParse(value.slice(separator + 1).toLowerCase());
    if (separator < 1 || !roleResult.success || !colorResult.success) {
      throw flowInspectionFailed(
        `Graph colour override "${value}" must use a supported ROLE=COLOUR or ROLE=#HEX value.`
      );
    }
    return { ...colors, [roleResult.data]: colorResult.data };
  }, {});
}

export async function writeGraphOutput(outputFile: string | undefined, graph: string): Promise<void> {
  if (outputFile === undefined) {
    return;
  }
  if (outputFile.trim().length === 0) {
    throw flowInspectionFailed('The graph output file path must not be empty.');
  }
  try {
    await writeFile(outputFile, graph, { encoding: 'utf8', flag: 'wx' });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw flowInspectionFailed(`Graph output file "${outputFile}" already exists.`);
    }
    throw flowInspectionFailed(`Failed to write graph output file "${outputFile}".`, error);
  }
}
