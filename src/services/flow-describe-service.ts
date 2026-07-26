/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowDefinitionAmbiguous, flowInspectionFailed, flowVersionNotFound } from '../errors/flow-errors.js';
import { flowApiNameSchema, namespaceSchema } from '../schemas/flow.js';
import type { FlowComparisonVersionSelector, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinition, FlowDefinitionGateway, FlowDefinitionLookup, FlowVersion } from '../types/flow.js';
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

interface ExpansionContext {
  definition: FlowDefinition;
  parent: VisitContext;
  name: string;
  path: string[];
}

function lookupForRequest(request: FlowDescribeRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

function lookupForSubflow(flowName: string): FlowDefinitionLookup {
  const separator = flowName.indexOf('__');
  const apiName = separator < 0 ? flowName : flowName.slice(separator + 2);
  const namespace = separator < 0 ? undefined : flowName.slice(0, separator);
  if (
    !flowApiNameSchema.safeParse(apiName).success ||
    (namespace !== undefined && !namespaceSchema.safeParse(namespace).success)
  ) {
    throw flowInspectionFailed(`Subflow name "${flowName}" is not a valid Salesforce metadata name.`);
  }
  return namespace === undefined ? { apiName } : { apiName, namespace };
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
    this.progress('resolving-flow', this.request.apiName);
    const definition = selectFlowDefinition(
      this.request.apiName,
      await this.gateways.definitions.findDefinitions(lookupForRequest(this.request))
    );
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const requestedVersion =
      typeof this.request.version === 'number' ? `v${this.request.version}` : this.request.version;
    this.progress('loading-versions', `${name} (${requestedVersion})`);
    const versions = await this.gateways.definitions.findVersions(definition.id);
    const version = selectVersion(definition, versions, this.request.version);
    const root = await this.visit({ definition, version, depth: 0, path: [name] });
    return { root, flows: this.flows, warnings: [...this.warnings.values()] };
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
    if (this.request.recursive) {
      await this.expandSubflows(description, context);
    }
    return description;
  }

  private async expandSubflows(description: FlowDescription, context: VisitContext): Promise<void> {
    await description.subflows.reduce(async (previous, subflow) => {
      await previous;
      await this.expandSubflow(subflow.flowName, context);
    }, Promise.resolve());
  }

  private async expandSubflow(flowName: string, parent: VisitContext): Promise<void> {
    const definition = await this.findSubflowDefinition(flowName, parent.path);
    if (definition === undefined) {
      return;
    }
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const path = [...parent.path, name];
    if (this.shouldStopExpansion({ definition, parent, name, path })) {
      return;
    }
    await this.visitSubflow(definition, parent, path);
  }

  private shouldStopExpansion({ definition, parent, name, path }: ExpansionContext): boolean {
    if (this.visited.has(definition.id)) {
      return true;
    }
    if (parent.depth >= this.request.maxDepth) {
      this.addWarning({ kind: 'depth-limit', flowName: name, path });
      return true;
    }
    return false;
  }

  private async findSubflowDefinition(flowName: string, path: string[]): Promise<FlowDefinition | undefined> {
    const definitions = await this.gateways.definitions.findDefinitions(lookupForSubflow(flowName));
    if (definitions.length === 0) {
      this.addWarning({ kind: 'missing-subflow', flowName, path: [...path, flowName] });
      return undefined;
    }
    if (definitions.length > 1) {
      throw flowDefinitionAmbiguous(flowName);
    }
    return definitions[0];
  }

  private async visitSubflow(definition: FlowDefinition, parent: VisitContext, path: string[]): Promise<void> {
    const name = qualifiedFlowName(definition.apiName, definition.namespace);
    const versions = await withFlowProgressStage(this.progress, {
      stage: 'loading-versions',
      detail: `${name} (${this.request.subflowVersion}, subflow)`,
      operation: async () => this.gateways.definitions.findVersions(definition.id),
    });
    const reference = subflowVersionReference(definition, this.request.subflowVersion);
    if (reference.id === null) {
      this.addWarning({ kind: 'missing-subflow-version', flowName: path.at(-1) ?? definition.apiName, path });
      return;
    }
    if (reference.fallback) {
      this.addWarning({ kind: 'subflow-version-fallback', flowName: path.at(-1) ?? definition.apiName, path });
    }
    const version = versionForId(definition, versions, reference);
    await this.visit({
      definition,
      version,
      depth: parent.depth + 1,
      path,
    });
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
