/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { flowLintFailed } from '../errors/flow-errors.js';
import type { FlowLintDirectoryResult } from '../types/flow-lint.js';
import { classifyFindings, scopedBaselineSchema } from './flow-lint-output.js';
import { qualifiedFlowName } from './flow-state.js';

const directorySchema = z
  .object({
    sourceDirectory: z.string().min(1),
    flows: z.array(scopedBaselineSchema),
  })
  .refine(
    ({ flows }) => new Set(flows.map((flow) => qualifiedFlowName(flow.apiName, flow.namespace))).size === flows.length,
    { message: 'A directory baseline must not contain duplicate qualified Flow identities.' }
  );

const documentSchema = z.union([
  directorySchema,
  z
    .object({ status: z.union([z.literal(0), z.literal(1)]), result: directorySchema, warnings: z.array(z.unknown()) })
    .transform(({ result }) => result),
]);

/** Match each Flow independently; directory paths may differ between developer and CI checkouts. */
export async function applyFlowLintDirectoryBaseline(
  result: FlowLintDirectoryResult,
  file: string | undefined
): Promise<FlowLintDirectoryResult> {
  if (file === undefined) {
    return result;
  }
  try {
    const document = documentSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8')) as unknown);
    const index = new Map(
      document.flows.map((flow) => [qualifiedFlowName(flow.apiName, flow.namespace), flow.findings])
    );
    const flows = result.flows.map((flow) =>
      classifyFindings(flow, index.get(qualifiedFlowName(flow.apiName, flow.namespace)) ?? [])
    );
    return {
      ...result,
      flows,
      newFindings: flows.flatMap((flow) => flow.newFindings),
      baselineFindings: flows.flatMap((flow) => flow.baselineFindings),
      newErrors: flows.reduce((total, flow) => total + flow.newErrors, 0),
      newWarnings: flows.reduce((total, flow) => total + flow.newWarnings, 0),
    };
  } catch (error: unknown) {
    throw flowLintFailed(`Could not read a valid directory lint baseline from "${resolve(file)}".`, error);
  }
}
