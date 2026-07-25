/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDependenciesFailed } from '../errors/flow-errors.js';
import { flowDependencyDirectionSchema } from '../schemas/flow.js';
import type {
  FlowDependenciesRequest,
  FlowDependenciesResult,
  FlowDependency,
  FlowDependencyGateway,
  FlowDependencyQueryDirection,
} from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup } from '../types/flow.js';
import { selectFlowDefinition } from '../utils/flow-state.js';

function createLookup(request: FlowDependenciesRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function requestedDirections(request: FlowDependenciesRequest): FlowDependencyQueryDirection[] {
  return request.direction === 'both' ? ['uses', 'used-by'] : [request.direction];
}

function dependencyKey(dependency: FlowDependency): string {
  return [
    dependency.direction,
    dependency.type ?? '',
    dependency.namespace ?? '',
    dependency.name ?? '',
    dependency.componentId ?? '',
  ].join('\u0000');
}

function sortDependencies(left: FlowDependency, right: FlowDependency): number {
  return dependencyKey(left).localeCompare(dependencyKey(right));
}

function uniqueDependencies(dependencies: ReadonlyArray<FlowDependency>): FlowDependency[] {
  const unique = new Map(dependencies.map((dependency) => [dependencyKey(dependency), dependency]));
  return [...unique.values()].sort(sortDependencies);
}

function createResult(
  request: FlowDependenciesRequest,
  definition: FlowDefinition,
  dependencies: ReadonlyArray<FlowDependency>
): FlowDependenciesResult {
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    direction: request.direction,
    dependencies: uniqueDependencies(dependencies),
    targetOrg: request.targetOrg,
  };
}

function shouldRethrow(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous', 'FlowDependenciesFailed'].includes(error.name)
  );
}

async function queryDependencies(
  gateway: FlowDefinitionGateway & FlowDependencyGateway,
  definition: FlowDefinition,
  request: FlowDependenciesRequest
): Promise<FlowDependency[]> {
  const queries = requestedDirections(request).map((direction) => gateway.findDependencies(definition.id, direction));
  return (await Promise.all(queries)).flat();
}

export class FlowDependenciesService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowDependencyGateway) {}

  public async getDependencies(request: FlowDependenciesRequest): Promise<FlowDependenciesResult> {
    if (!flowDependencyDirectionSchema.safeParse(request.direction).success) {
      throw flowDependenciesFailed('The Flow dependency direction is invalid.');
    }
    try {
      const definition = selectFlowDefinition(
        request.apiName,
        await this.gateway.findDefinitions(createLookup(request))
      );
      const dependencies = await queryDependencies(this.gateway, definition, request);
      return createResult(request, definition, dependencies);
    } catch (error: unknown) {
      if (shouldRethrow(error)) {
        throw error;
      }
      throw flowDependenciesFailed(`Failed to query dependencies for Flow "${request.apiName}".`, error);
    }
  }
}
