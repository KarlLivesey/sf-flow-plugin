/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDefinitionAmbiguous, flowInspectionFailed, flowVersionNotFound } from '../errors/flow-errors.js';
import type { FlowComparisonVersionSelector, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowVersion } from '../types/flow.js';
import type {
  FlowDescribeRequest,
  FlowDescribeResult,
  FlowDescription,
  FlowSubflowVersionSelector,
  FlowTraversalWarning,
} from '../types/flow-inspection.js';
import { filterFlowDescriptionSections } from '../utils/flow-description-sections.js';
import { validateFlowDescribeRequest } from '../utils/flow-describe-validation.js';
import { noFlowProgress, type FlowProgressReporter, withFlowProgressStage } from '../utils/flow-progress.js';
import { analyseFlowMetadata } from '../utils/flow-metadata-analysis.js';
import { qualifiedFlowName, selectFlowDefinition } from '../utils/flow-state.js';
import { flowDefinitionLookupForRequest, flowDefinitionLookupForSubflow } from '../utils/flow-subflow-lookup.js';

interface TraversalResult {
  root: FlowDescription;
  flows: FlowDescription[];
  warnings: FlowTraversalWarning[];
}

interface VisitContext {
  definition: FlowDefinition;
  version: FlowVersion;
  depth: number;
  path: string[];
}

interface TraversalQueueEntry {
  context: VisitContext;
  description: FlowDescription;
}

interface VersionReference {
  id: string | null;
  selector: 'active' | 'latest';
}

interface SubflowVersionReference extends VersionReference {
  fallback: boolean;
}

function versionForId(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  reference: VersionReference
): FlowVersion {
  const { id: versionId, selector } = reference;
  if (versionId === null) {
    throw flowInspectionFailed(`Flow "${definition.apiName}" does not have an ${selector} version.`);
  }
  const version = versions.find((item) => item.id === versionId);
  if (version === undefined) {
    throw flowInspectionFailed(`Salesforce returned an unknown ${selector} version for Flow "${definition.apiName}".`);
  }
  return version;
}

function selectVersion(
  definition: FlowDefinition,
  versions: ReadonlyArray<FlowVersion>,
  selector: FlowComparisonVersionSelector
): FlowVersion {
  if (selector === 'active') {
    return versionForId(definition, versions, { id: definition.activeVersionId, selector });
  }
  if (selector === 'latest') {
    return versionForId(definition, versions, { id: definition.latestVersionId, selector });
  }
  const version = versions.find((item) => item.versionNumber === selector);
  if (version === undefined) {
    throw flowVersionNotFound(definition.apiName, selector);
  }
  return version;
}

function subflowVersionReference(
  definition: FlowDefinition,
  selector: FlowSubflowVersionSelector
): SubflowVersionReference {
  if (selector === 'latest' || definition.activeVersionId !== null) {
    const id = selector === 'latest' ? definition.latestVersionId : definition.activeVersionId;
    return { id, selector, fallback: false };
  }
  return { id: definition.latestVersionId, selector: 'latest', fallback: definition.latestVersionId !== null };
}

function warningKey(warning: FlowTraversalWarning): string {
  return `${warning.kind}\u0000${warning.flowName}\u0000${warning.path.join('\u0000')}`;
}

class FlowMetadataTraversal {
  private readonly flows: FlowDescription[] = [];
  private readonly warnings = new Map<string, FlowTraversalWarning>();
  private readonly visited = new Set<string>();

  public constructor(
    private readonly gateways: { definitions: FlowDefinitionGateway; metadata: FlowMetadataGateway },
    private readonly request: FlowDescribeRequest,
    private readonly progress: FlowProgressReporter
  ) {}

  public async traverse(): Promise<TraversalResult> {
    const rootContext = await this.resolveRootContext();
    const root = await this.visit(rootContext);
    if (this.request.recursive) {
      await this.expandBreadthFirst([{ context: rootContext, description: root }]);
    }
    return { root, flows: this.flows, warnings: [...this.warnings.values()] };
  }

  private async resolveRootContext(): Promise<VisitContext> {
    this.progress('resolving-flow', this.request.apiName);
    const definition = selectFlowDefinition(
      this.request.apiName,
      await this.gateways.definitions.findDefinitions(flowDefinitionLookupForRequest(this.request))
    );
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const requestedVersion =
      typeof this.request.version === 'number' ? `v${this.request.version}` : this.request.version;
    this.progress('loading-versions', `${name} (${requestedVersion})`);
    const versions = await this.gateways.definitions.findVersions(definition.id);
    const version = selectVersion(definition, versions, this.request.version);
    return { definition, version, depth: 0, path: [name] };
  }

  private addWarning(warning: FlowTraversalWarning): void {
    this.warnings.set(warningKey(warning), warning);
  }

  private async visit(context: VisitContext): Promise<FlowDescription> {
    this.progress(
      'loading-metadata',
      `${qualifiedFlowName(context.definition.apiName, context.definition.namespace)} v${context.version.versionNumber}`
    );
    const metadata = await this.gateways.metadata.getVersionMetadata(context.version.id);
    const description = analyseFlowMetadata({ ...context, metadata });
    this.flows.push(description);
    this.visited.add(context.definition.id);
    return description;
  }

  private async expandBreadthFirst(queue: TraversalQueueEntry[]): Promise<void> {
    const current = queue.shift();
    if (current === undefined) {
      return;
    }
    const expanded = await current.description.subflows.reduce(async (previous, subflow) => {
      const entries = await previous;
      const next = await this.resolveSubflow(subflow.flowName, current.context);
      return next === undefined ? entries : [...entries, { context: next, description: await this.visit(next) }];
    }, Promise.resolve([] as TraversalQueueEntry[]));
    await this.expandBreadthFirst([...queue, ...expanded]);
  }

  private async findSubflowDefinition(flowName: string, parent: VisitContext): Promise<FlowDefinition | undefined> {
    const lookup = flowDefinitionLookupForSubflow(flowName);
    if (lookup === null) {
      return this.missingSubflow(flowName, parent.path);
    }
    const found = await this.gateways.definitions.findDefinitions(lookup);
    const definitions =
      lookup.namespace === undefined
        ? found.filter((definition) => definition.namespace === parent.definition.namespace)
        : found;
    if (definitions.length === 0) {
      return this.missingSubflow(flowName, parent.path);
    }
    if (definitions.length > 1) {
      throw flowDefinitionAmbiguous(flowName);
    }
    return definitions[0];
  }

  private missingSubflow(flowName: string, path: string[]): FlowDefinition | undefined {
    this.addWarning({ kind: 'missing-subflow', flowName, path: [...path, flowName] });
    return undefined;
  }

  private async resolveSubflow(flowName: string, parent: VisitContext): Promise<VisitContext | undefined> {
    const definition = await this.findSubflowDefinition(flowName, parent);
    if (definition === undefined) {
      return undefined;
    }
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const path = [...parent.path, name];
    if (this.shouldStopExpansion(definition, parent, path)) {
      return undefined;
    }
    const version = await this.resolveSubflowVersion(definition, name, path);
    return version === undefined ? undefined : { definition, version, depth: parent.depth + 1, path };
  }

  private shouldStopExpansion(definition: FlowDefinition, parent: VisitContext, path: string[]): boolean {
    if (this.visited.has(definition.id)) {
      return true;
    }
    if (parent.depth < this.request.maxDepth) {
      return false;
    }
    this.addWarning({ kind: 'depth-limit', flowName: path.at(-1) ?? definition.apiName, path });
    return true;
  }

  private async resolveSubflowVersion(
    definition: FlowDefinition,
    name: string,
    path: string[]
  ): Promise<FlowVersion | undefined> {
    const versions = await withFlowProgressStage(this.progress, {
      stage: 'loading-versions',
      detail: `${name} (${this.request.subflowVersion}, subflow)`,
      operation: async () => this.gateways.definitions.findVersions(definition.id),
    });
    const reference = subflowVersionReference(definition, this.request.subflowVersion);
    if (reference.id === null) {
      this.addWarning({ kind: 'missing-subflow-version', flowName: path.at(-1) ?? definition.apiName, path });
      return undefined;
    }
    if (reference.fallback) {
      this.addWarning({ kind: 'subflow-version-fallback', flowName: path.at(-1) ?? definition.apiName, path });
    }
    return versionForId(definition, versions, reference);
  }
}

function createResult(request: FlowDescribeRequest, traversal: TraversalResult): FlowDescribeResult {
  const sections = request.sections ?? [];
  return {
    apiName: traversal.root.apiName,
    namespace: traversal.root.namespace,
    requestedVersion: request.version,
    resolvedVersion: traversal.root.versionNumber,
    subflowVersion: request.subflowVersion,
    recursive: request.recursive,
    maxDepth: request.maxDepth,
    sections,
    flows: traversal.flows.map((flow) => filterFlowDescriptionSections(flow, sections)),
    warnings: traversal.warnings,
    targetOrg: request.targetOrg,
  };
}

function shouldRethrow(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['FlowDefinitionNotFound', 'FlowDefinitionAmbiguous', 'FlowVersionNotFound', 'FlowInspectionFailed'].includes(
      error.name
    )
  );
}

export class FlowDescribeService {
  public constructor(
    private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway,
    private readonly metadataGateway: FlowMetadataGateway = gateway
  ) {}

  public async describe(
    request: FlowDescribeRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowDescribeResult> {
    validateFlowDescribeRequest(request);
    try {
      return createResult(
        request,
        await new FlowMetadataTraversal(
          { definitions: this.gateway, metadata: this.metadataGateway },
          request,
          progress
        ).traverse()
      );
    } catch (error: unknown) {
      if (shouldRethrow(error)) {
        throw error;
      }
      throw flowInspectionFailed(`Failed to describe Flow "${request.apiName}".`, error);
    }
  }
}
