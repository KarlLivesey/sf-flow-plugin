/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDeactivationFailed, flowDeactivationVerificationFailed } from '../errors/flow-errors.js';
import { positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowDeactivationRequest,
  FlowDeactivationResult,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowVersion,
} from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter, withFlowProgressStage } from '../utils/flow-progress.js';
import { assertExpectedActiveVersion, assertExpectedLatestVersion } from '../utils/flow-concurrency.js';
import { qualifiedFlowName, resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

interface FlowState {
  definition: FlowDefinition;
  versions: ReadonlyArray<FlowVersion>;
}

function createLookup(request: FlowDeactivationRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function createResult(request: FlowDeactivationRequest, state: FlowState, changed: boolean): FlowDeactivationResult {
  return {
    apiName: state.definition.apiName,
    namespace: state.definition.namespace,
    definitionId: state.definition.id,
    previousActiveVersion: resolveVersionNumber(
      state.definition.apiName,
      state.definition.activeVersionId,
      state.versions
    ),
    activeVersion: null,
    changed,
    dryRun: request.dryRun,
    targetOrg: request.targetOrg,
  };
}

export class FlowDeactivationService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async deactivate(
    request: FlowDeactivationRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowDeactivationResult> {
    if (
      [request.expectedActiveVersion, request.expectedLatestVersion].some(
        (version) => version !== undefined && !positiveFlowVersionSchema.safeParse(version).success
      )
    ) {
      throw flowDeactivationFailed('Expected Flow versions must be positive whole numbers.');
    }
    progress('resolving-flow', request.apiName);
    const state = await this.getState(request, progress);
    assertExpectedActiveVersion(
      request.apiName,
      request.expectedActiveVersion,
      resolveVersionNumber(request.apiName, state.definition.activeVersionId, state.versions)
    );
    assertExpectedLatestVersion(
      request.apiName,
      request.expectedLatestVersion,
      resolveVersionNumber(request.apiName, state.definition.latestVersionId, state.versions)
    );
    return this.executeDeactivation(request, state, progress);
  }

  private async executeDeactivation(
    request: FlowDeactivationRequest,
    state: FlowState,
    progress: FlowProgressReporter
  ): Promise<FlowDeactivationResult> {
    if (state.definition.activeVersionId === null) {
      return createResult(request, state, false);
    }
    const detail = qualifiedFlowName(state.definition.apiName, state.definition.namespace);
    await withFlowProgressStage(progress, {
      stage: 'checking-permissions',
      detail: `${detail} (deactivate)`,
      operation: async () => this.gateway.assertMutationAllowed('update-definition'),
    });
    if (request.dryRun) {
      return createResult(request, state, false);
    }
    await withFlowProgressStage(progress, {
      stage: 'checking-current-state',
      detail: `${detail} (checking active and latest guards)`,
      operation: async () => this.assertCurrentVersions(request),
    });
    await withFlowProgressStage(progress, {
      stage: 'applying-change',
      detail,
      operation: async () => this.clearActiveVersion(state.definition),
    });
    await withFlowProgressStage(progress, {
      stage: 'verifying-change',
      detail,
      operation: async () => this.verify(request),
    });
    return createResult(request, state, true);
  }

  private async assertCurrentVersions(request: FlowDeactivationRequest): Promise<void> {
    if (request.expectedActiveVersion === undefined && request.expectedLatestVersion === undefined) {
      return;
    }
    const state = await this.getState(request);
    assertExpectedActiveVersion(
      request.apiName,
      request.expectedActiveVersion,
      resolveVersionNumber(request.apiName, state.definition.activeVersionId, state.versions)
    );
    assertExpectedLatestVersion(
      request.apiName,
      request.expectedLatestVersion,
      resolveVersionNumber(request.apiName, state.definition.latestVersionId, state.versions)
    );
  }

  private async getState(
    request: FlowDeactivationRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowState> {
    try {
      const definitions = await this.gateway.findDefinitions(createLookup(request));
      const definition = selectFlowDefinition(request.apiName, definitions);
      progress('loading-versions', `${qualifiedFlowName(definition.apiName, definition.namespace)} (all versions)`);
      const versions = await this.gateway.findVersions(definition.id);
      return { definition, versions };
    } catch (error: unknown) {
      if (error instanceof Error && ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous'].includes(error.name)) {
        throw error;
      }
      throw flowDeactivationFailed(`Failed to query Flow "${request.apiName}".`, error);
    }
  }

  private async clearActiveVersion(definition: FlowDefinition): Promise<void> {
    try {
      await this.gateway.setActiveVersion(definition.id, null);
    } catch (error: unknown) {
      throw flowDeactivationFailed(`Failed to deactivate Flow "${definition.apiName}".`, error);
    }
  }

  private async verify(request: FlowDeactivationRequest): Promise<void> {
    const verified = await this.getState(request);
    if (verified.definition.activeVersionId !== null) {
      throw flowDeactivationVerificationFailed(request.apiName);
    }
  }
}
