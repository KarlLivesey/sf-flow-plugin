/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import {
  flowDeleteVersionFailed,
  flowDeleteVersionVerificationFailed,
  flowVersionNotFound,
} from '../errors/flow-errors.js';
import { positiveFlowVersionSchema } from '../schemas/flow.js';
import type {
  FlowDeleteVersionPlan,
  FlowDeleteVersionRequest,
  FlowDeleteVersionResult,
} from '../types/flow-deletion.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
import { assertExpectedActiveVersion, assertExpectedLatestVersion } from '../utils/flow-concurrency.js';
import { noFlowProgress, type FlowProgressReporter, withFlowProgressStage } from '../utils/flow-progress.js';
import { qualifiedFlowName, resolveVersionNumber, selectFlowDefinition } from '../utils/flow-state.js';

interface FlowState {
  definition: FlowDefinition;
  versions: ReadonlyArray<FlowVersion>;
}

interface DeletionContext {
  request: FlowDeleteVersionRequest;
  state: FlowState;
  selected: FlowVersion;
}

function lookup(request: FlowDeleteVersionRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function versionNumbers(state: FlowState): { active: number | null; latest: number | null } {
  return {
    active: resolveVersionNumber(state.definition.apiName, state.definition.activeVersionId, state.versions),
    latest: resolveVersionNumber(state.definition.apiName, state.definition.latestVersionId, state.versions),
  };
}

function assertGuards(context: DeletionContext): void {
  const numbers = versionNumbers(context.state);
  assertExpectedActiveVersion(context.request.apiName, context.request.expectedActiveVersion, numbers.active);
  assertExpectedLatestVersion(context.request.apiName, context.request.expectedLatestVersion, numbers.latest);
  if (context.selected.id === context.state.definition.activeVersionId) {
    throw flowDeleteVersionFailed(`Flow "${context.request.apiName}" version ${context.request.version} is active.`);
  }
  if (context.selected.id === context.state.definition.latestVersionId) {
    throw flowDeleteVersionFailed(`Flow "${context.request.apiName}" version ${context.request.version} is latest.`);
  }
}

function createResult(context: DeletionContext, changed: boolean): FlowDeleteVersionResult {
  const numbers = versionNumbers(context.state);
  const plan: FlowDeleteVersionPlan = {
    action: 'delete-version',
    versionId: context.selected.id,
    versionNumber: context.selected.versionNumber,
    status: context.selected.status,
    active: false,
    latest: false,
  };
  return {
    apiName: context.state.definition.apiName,
    namespace: context.state.definition.namespace,
    definitionId: context.state.definition.id,
    activeVersion: numbers.active,
    latestVersion: numbers.latest,
    expectedActiveVersion: context.request.expectedActiveVersion ?? null,
    expectedLatestVersion: context.request.expectedLatestVersion ?? null,
    plan,
    changed,
    dryRun: context.request.dryRun,
    targetOrg: context.request.targetOrg,
  };
}

function validateRequest(request: FlowDeleteVersionRequest): void {
  const values = [request.version, request.expectedActiveVersion, request.expectedLatestVersion].filter(
    (value): value is number => value !== undefined
  );
  if (!values.every((value) => positiveFlowVersionSchema.safeParse(value).success)) {
    throw flowDeleteVersionFailed('Flow version guards must be positive whole numbers.');
  }
}

export class FlowDeleteVersionService {
  public constructor(private readonly gateway: FlowDefinitionGateway) {}

  public async deleteVersion(
    request: FlowDeleteVersionRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowDeleteVersionResult> {
    validateRequest(request);
    const context = await this.getContext(request, progress);
    assertGuards(context);
    await this.checkPermission(context, progress);
    if (request.dryRun) {
      return createResult(context, false);
    }
    const current = await this.getContext(request, progress);
    assertGuards(current);
    await this.deleteAndVerify(current, progress);
    return createResult(current, true);
  }

  private async getContext(
    request: FlowDeleteVersionRequest,
    progress: FlowProgressReporter
  ): Promise<DeletionContext> {
    try {
      return await this.loadContext(request, progress);
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow')) {
        throw error;
      }
      throw flowDeleteVersionFailed(`Failed to inspect Flow "${request.apiName}" version ${request.version}.`, error);
    }
  }

  private async loadContext(
    request: FlowDeleteVersionRequest,
    progress: FlowProgressReporter
  ): Promise<DeletionContext> {
    progress('resolving-flow', request.apiName);
    const definition = selectFlowDefinition(request.apiName, await this.gateway.findDefinitions(lookup(request)));
    progress('loading-versions', `${qualifiedFlowName(definition.apiName, definition.namespace)} v${request.version}`);
    const versions = await this.gateway.findVersions(definition.id);
    const selected = versions.find((version) => version.versionNumber === request.version);
    if (selected === undefined) {
      throw flowVersionNotFound(request.apiName, request.version);
    }
    return { request, state: { definition, versions }, selected };
  }

  private async checkPermission(context: DeletionContext, progress: FlowProgressReporter): Promise<void> {
    const name = qualifiedFlowName(context.state.definition.apiName, context.state.definition.namespace);
    await withFlowProgressStage(progress, {
      stage: 'checking-permissions',
      detail: `${name} v${context.selected.versionNumber} (delete Flow version)`,
      operation: async () => this.gateway.assertMutationAllowed('delete-version'),
    });
  }

  private async deleteAndVerify(context: DeletionContext, progress: FlowProgressReporter): Promise<void> {
    const name = qualifiedFlowName(context.state.definition.apiName, context.state.definition.namespace);
    await withFlowProgressStage(progress, {
      stage: 'deleting-versions',
      detail: `${name} v${context.selected.versionNumber}`,
      operation: async () => this.gateway.deleteVersion(context.selected.id),
    });
    await withFlowProgressStage(progress, {
      stage: 'verifying-change',
      detail: `${name} v${context.selected.versionNumber} (absent)`,
      operation: async () => this.verify(context),
    });
  }

  private async verify(context: DeletionContext): Promise<void> {
    const versions = await this.gateway.findVersions(context.state.definition.id);
    if (versions.some((version) => version.id === context.selected.id)) {
      throw flowDeleteVersionVerificationFailed(context.request.apiName, context.request.version);
    }
  }
}
