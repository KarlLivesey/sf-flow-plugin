/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  flowActivationFailed,
  flowActivationVerificationFailed,
  flowDefinitionAmbiguous,
  flowDefinitionNotFound,
} from '../errors/flow-errors.js';
import { positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowActivationPlan,
  FlowActivationRequest,
  FlowActivationResult,
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowDefinitionService as FlowDefinitionServiceContract,
  FlowVersion,
  FlowVersionNumber,
} from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter, withFlowProgressStage } from '../utils/flow-progress.js';
import { assertExpectedActiveVersion } from '../utils/flow-concurrency.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { resolveFlowVersion } from '../utils/resolve-flow-version.js';

function createLookup(request: FlowActivationRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function selectDefinition(apiName: string, definitions: ReadonlyArray<FlowDefinition>): FlowDefinition {
  if (definitions.length === 0) {
    throw flowDefinitionNotFound(apiName);
  }
  if (definitions.length > 1) {
    throw flowDefinitionAmbiguous(apiName);
  }
  const definition = definitions[0];
  if (definition === undefined) {
    throw flowActivationFailed(`Salesforce returned an invalid definition result for Flow "${apiName}".`);
  }
  return definition;
}

function activeVersionNumber(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>
): FlowVersionNumber | null {
  if (definition.activeVersionId === null) {
    return null;
  }
  const activeVersion = versions.find((version) => version.id === definition.activeVersionId);
  if (activeVersion === undefined) {
    throw flowActivationFailed(`Salesforce returned an unknown active version for Flow "${definition.apiName}".`);
  }
  return activeVersion.versionNumber;
}

function createResult(
  request: FlowActivationRequest,
  plan: FlowActivationPlan,
  changed: boolean
): FlowActivationResult {
  return {
    apiName: plan.definition.apiName,
    namespace: plan.definition.namespace,
    definitionId: plan.definition.id,
    requestedVersion: plan.requestedVersion,
    resolvedVersion: plan.selectedVersion.versionNumber,
    previousActiveVersion: plan.previousActiveVersion,
    activeVersion: plan.selectedVersion.versionNumber,
    changed,
    dryRun: request.dryRun,
    targetOrg: request.targetOrg,
  };
}

export class FlowDefinitionService implements FlowDefinitionServiceContract {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async planActivation(
    request: FlowActivationRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowActivationPlan> {
    progress('resolving-flow', request.apiName);
    const definitions = await this.findDefinitions(request);
    const definition = selectDefinition(request.apiName, definitions);
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const requestedVersion =
      typeof request.requestedVersion === 'number' ? `v${request.requestedVersion}` : request.requestedVersion;
    progress('loading-versions', `${name} (${requestedVersion})`);
    const versions = await this.findVersions(definition);
    const selectedVersion = resolveFlowVersion(request.apiName, request.requestedVersion, versions);
    const previousActiveVersion = activeVersionNumber(definition, versions);
    return {
      definition,
      requestedVersion: request.requestedVersion,
      selectedVersion,
      previousActiveVersion,
      changeRequired: previousActiveVersion !== selectedVersion.versionNumber,
    };
  }

  public async activate(
    request: FlowActivationRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowActivationResult> {
    if (
      request.expectedActiveVersion !== undefined &&
      !positiveFlowVersionSchema.safeParse(request.expectedActiveVersion).success
    ) {
      throw flowActivationFailed('The expected active Flow version must be a positive whole number.');
    }
    const plan = await this.planActivation(request, progress);
    assertExpectedActiveVersion(request.apiName, request.expectedActiveVersion, plan.previousActiveVersion);
    return this.executeActivation(request, plan, progress);
  }

  private async executeActivation(
    request: FlowActivationRequest,
    plan: FlowActivationPlan,
    progress: FlowProgressReporter
  ): Promise<FlowActivationResult> {
    if (!plan.changeRequired) {
      return createResult(request, plan, false);
    }
    const detail = `${qualifiedFlowName(plan.definition.apiName, plan.definition.namespace)} v${
      plan.selectedVersion.versionNumber
    }`;
    await withFlowProgressStage(progress, {
      stage: 'checking-permissions',
      detail: `${detail} (activate)`,
      operation: async () => this.gateway.assertMutationAllowed('update-definition'),
    });
    if (request.dryRun) {
      return createResult(request, plan, false);
    }
    await withFlowProgressStage(progress, {
      stage: 'checking-current-state',
      detail: `${detail} (expected active v${request.expectedActiveVersion ?? 'any'})`,
      operation: async () => this.assertCurrentActiveVersion(request),
    });
    await withFlowProgressStage(progress, {
      stage: 'applying-change',
      detail,
      operation: async () => this.update(plan),
    });
    await withFlowProgressStage(progress, {
      stage: 'verifying-change',
      detail,
      operation: async () => this.verify(plan, request),
    });
    return createResult(request, plan, true);
  }

  private async assertCurrentActiveVersion(request: FlowActivationRequest): Promise<void> {
    if (request.expectedActiveVersion === undefined) {
      return;
    }
    const definition = selectDefinition(request.apiName, await this.findDefinitions(request));
    const versions = await this.findVersions(definition);
    assertExpectedActiveVersion(
      request.apiName,
      request.expectedActiveVersion,
      activeVersionNumber(definition, versions)
    );
  }

  private async update(plan: FlowActivationPlan): Promise<void> {
    try {
      await this.gateway.setActiveVersion(plan.definition.id, plan.selectedVersion.versionNumber);
    } catch (error: unknown) {
      throw flowActivationFailed(`Failed to activate Flow "${plan.definition.apiName}".`, error);
    }
  }

  private async verify(plan: FlowActivationPlan, request: FlowActivationRequest): Promise<void> {
    const definitions = await this.findDefinitions(request);
    const definition = selectDefinition(request.apiName, definitions);
    const versions = await this.findVersions(definition);
    const verifiedVersion = activeVersionNumber(definition, versions);
    if (verifiedVersion !== plan.selectedVersion.versionNumber) {
      throw flowActivationVerificationFailed(plan.definition.apiName, plan.selectedVersion.versionNumber);
    }
  }

  private async findDefinitions(request: FlowActivationRequest): Promise<ReadonlyArray<FlowDefinition>> {
    try {
      return await this.gateway.findDefinitions(createLookup(request));
    } catch (error: unknown) {
      throw flowActivationFailed(`Failed to query the definition for Flow "${request.apiName}".`, error);
    }
  }

  private async findVersions(definition: FlowDefinition): Promise<ReadonlyArray<FlowVersion>> {
    try {
      return await this.gateway.findVersions(definition.id);
    } catch (error: unknown) {
      throw flowActivationFailed(`Failed to query versions for Flow "${definition.apiName}".`, error);
    }
  }
}
