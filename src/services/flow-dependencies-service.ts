/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDependenciesFailed } from '../errors/flow-errors.js';
import { flowDependencyDirectionSchema, flowDependencyTypeSchema, nonnegativeIntegerSchema } from '../schemas/flow.js';
import type {
  FlowDependenciesRequest,
  FlowDependenciesResult,
  FlowDependency,
  FlowDependencyGateway,
  FlowDependencyQueryDirection,
  IndexedFlowDependency,
} from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup } from '../types/flow.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';

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
    dependency.sourceDefinitionId,
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
  traversal: DependencyTraversal
): FlowDependenciesResult {
  return {
    apiName: definition.apiName,
    namespace: definition.namespace,
    definitionId: definition.id,
    direction: request.direction,
    recursive: request.recursive,
    maxDepth: request.maxDepth,
    types: request.types,
    definitionsScanned: traversal.definitionsScanned,
    dependencies: uniqueDependencies(traversal.dependencies),
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
): Promise<IndexedFlowDependency[]> {
  const types =
    request.recursive && request.types.length > 0 ? [...new Set([...request.types, 'Flow'])] : request.types;
  const queries = requestedDirections(request).map((direction) =>
    gateway.findDependencies(definition.id, direction, types)
  );
  return (await Promise.all(queries)).flat();
}

interface DependencyScope {
  definition: FlowDefinition;
  depth: number;
}

interface DependencyTraversal {
  dependencies: FlowDependency[];
  definitionsScanned: number;
}

interface DependencyTraversalState {
  dependencies: FlowDependency[];
  visited: Set<string>;
}

interface DependencyTraversalContext {
  gateway: FlowDefinitionGateway & FlowDependencyGateway;
  request: FlowDependenciesRequest;
  progress: FlowProgressReporter;
}

interface DependencyBatch {
  scope: DependencyScope;
  indexed: IndexedFlowDependency[];
}

function scopeDepth(scopes: ReadonlyArray<DependencyScope>): number {
  return scopes[0]?.depth ?? 0;
}

function unvisitedScopes(scopes: ReadonlyArray<DependencyScope>, visited: ReadonlySet<string>): DependencyScope[] {
  return [
    ...new Map(
      scopes.filter((scope) => !visited.has(scope.definition.id)).map((scope) => [scope.definition.id, scope] as const)
    ).values(),
  ];
}

function decorateDependency(scope: DependencyScope, dependency: IndexedFlowDependency): FlowDependency {
  return {
    ...dependency,
    sourceDefinitionId: scope.definition.id,
    sourceApiName: scope.definition.apiName,
    sourceNamespace: scope.definition.namespace,
    depth: scope.depth,
  };
}

function requestedDependency(request: FlowDependenciesRequest, dependency: IndexedFlowDependency): boolean {
  return request.types.length === 0 || (dependency.type !== null && request.types.includes(dependency.type));
}

function flowReferenceKey(dependency: IndexedFlowDependency): string | null {
  return dependency.type === 'Flow' && dependency.name !== null
    ? `${dependency.namespace ?? ''}\u0000${dependency.name}`
    : null;
}

async function resolveReferencedFlows(
  gateway: FlowDefinitionGateway,
  dependencies: ReadonlyArray<IndexedFlowDependency>
): Promise<FlowDefinition[]> {
  const references = new Map(
    dependencies
      .map((dependency) => [flowReferenceKey(dependency), dependency] as const)
      .filter((entry): entry is readonly [string, IndexedFlowDependency] => entry[0] !== null)
  );
  const resolved = await Promise.all(
    [...references.values()].map(async (dependency) => {
      const definitions = await gateway.findDefinitions({ apiName: dependency.name ?? '' });
      return definitions.filter((definition) => definition.namespace === dependency.namespace);
    })
  );
  return resolved.flat();
}

async function queryScope(context: DependencyTraversalContext, scope: DependencyScope): Promise<DependencyBatch> {
  const name = qualifiedFlowName(scope.definition.apiName, scope.definition.namespace);
  context.progress('loading-dependencies', `${name} (${context.request.direction}, depth ${scope.depth})`);
  const indexed = await queryDependencies(context.gateway, scope.definition, context.request);
  return { scope, indexed };
}

async function traverseLevel(
  context: DependencyTraversalContext,
  scopes: ReadonlyArray<DependencyScope>,
  state: DependencyTraversalState
): Promise<void> {
  const current = unvisitedScopes(scopes, state.visited);
  if (current.length === 0) {
    return;
  }
  current.forEach((scope) => state.visited.add(scope.definition.id));
  const batches = await Promise.all(current.map((scope) => queryScope(context, scope)));
  state.dependencies.push(
    ...batches.flatMap(({ scope, indexed }) =>
      indexed
        .filter((dependency) => requestedDependency(context.request, dependency))
        .map((dependency) => decorateDependency(scope, dependency))
    )
  );
  if (!context.request.recursive || scopeDepth(current) >= context.request.maxDepth) {
    return;
  }
  const definitions = (
    await Promise.all(batches.map(({ indexed }) => resolveReferencedFlows(context.gateway, indexed)))
  ).flat();
  await traverseLevel(
    context,
    definitions.map((definition) => ({ definition, depth: scopeDepth(current) + 1 })),
    state
  );
}

async function traverseDependencies(
  context: DependencyTraversalContext,
  root: FlowDefinition
): Promise<DependencyTraversal> {
  const state: DependencyTraversalState = { dependencies: [], visited: new Set() };
  await traverseLevel(context, [{ definition: root, depth: 0 }], state);
  return { dependencies: state.dependencies, definitionsScanned: state.visited.size };
}

async function resolveDependencies(
  gateway: FlowDefinitionGateway & FlowDependencyGateway,
  request: FlowDependenciesRequest,
  progress: FlowProgressReporter
): Promise<FlowDependenciesResult> {
  progress('resolving-flow', request.apiName);
  const definition = selectFlowDefinition(request.apiName, await gateway.findDefinitions(createLookup(request)));
  const name = qualifiedFlowName(definition.apiName, definition.namespace);
  const traversal = await traverseDependencies({ gateway, request, progress }, definition);
  progress('analysing-results', `${name} (${traversal.dependencies.length} dependency records)`);
  return createResult(request, definition, traversal);
}

export class FlowDependenciesService {
  public constructor(private readonly gateway: FlowDefinitionGateway & FlowDependencyGateway) {}

  public async getDependencies(
    request: FlowDependenciesRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowDependenciesResult> {
    if (
      !flowDependencyDirectionSchema.safeParse(request.direction).success ||
      !nonnegativeIntegerSchema.safeParse(request.maxDepth).success ||
      !request.types.every((type) => flowDependencyTypeSchema.safeParse(type).success)
    ) {
      throw flowDependenciesFailed('The Flow dependency traversal options are invalid.');
    }
    try {
      return await resolveDependencies(this.gateway, request, progress);
    } catch (error: unknown) {
      if (shouldRethrow(error)) {
        throw error;
      }
      throw flowDependenciesFailed(`Failed to query dependencies for Flow "${request.apiName}".`, error);
    }
  }
}
