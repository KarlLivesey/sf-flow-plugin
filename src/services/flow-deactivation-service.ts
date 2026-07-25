/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDeactivationFailed, flowDeactivationVerificationFailed } from '../errors/flow-errors.js';
import type {
  FlowDeactivationRequest,
  FlowDeactivationResult,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowVersion,
} from '../types/flow.js';
import { resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

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

  public async deactivate(request: FlowDeactivationRequest): Promise<FlowDeactivationResult> {
    const state = await this.getState(request);
    if (state.definition.activeVersionId === null) {
      return createResult(request, state, false);
    }
    await this.gateway.assertMutationAllowed('update-definition');
    if (request.dryRun) {
      return createResult(request, state, false);
    }
    await this.clearActiveVersion(state.definition);
    await this.verify(request);
    return createResult(request, state, true);
  }

  private async getState(request: FlowDeactivationRequest): Promise<FlowState> {
    try {
      const definitions = await this.gateway.findDefinitions(createLookup(request));
      const definition = selectFlowDefinition(request.apiName, definitions);
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
