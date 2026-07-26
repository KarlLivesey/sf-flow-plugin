/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowPruneFailed, flowPruneVerificationFailed } from '../errors/flow-errors.js';
import type { FlowDefinitionGateway, FlowPruneVersion } from '../types/flow.js';
import type { FlowProgressReporter } from './flow-progress.js';
import { qualifiedFlowName } from './flow-state.js';

interface PruneMutationPlan {
  definition: { apiName: string; namespace: string | null; id: string };
  plannedDeletions: FlowPruneVersion[];
}

export async function deletePrunedVersions(
  gateway: FlowDefinitionGateway,
  plan: PruneMutationPlan,
  progress: FlowProgressReporter
): Promise<void> {
  try {
    await plan.plannedDeletions.reduce(async (previous, version) => {
      await previous;
      progress(
        'deleting-versions',
        `${qualifiedFlowName(plan.definition.apiName, plan.definition.namespace)} v${version.versionNumber}`
      );
      await gateway.deleteVersion(version.id);
    }, Promise.resolve());
  } catch (error: unknown) {
    throw flowPruneFailed(`Failed to prune Flow "${plan.definition.apiName}".`, error);
  }
}

export async function verifyPrunedVersions(gateway: FlowDefinitionGateway, plan: PruneMutationPlan): Promise<void> {
  const remaining = await gateway.findVersions(plan.definition.id);
  const remainingIds = new Set(remaining.map((version) => version.id));
  if (plan.plannedDeletions.some((version) => remainingIds.has(version.id))) {
    throw flowPruneVerificationFailed(plan.definition.apiName);
  }
}
