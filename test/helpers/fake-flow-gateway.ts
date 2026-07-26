/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import type {
  FlowDependencyQueryDirection,
  FlowDependencyQueryResult,
  IndexedFlowDependency,
  JsonObject,
} from '../../src/types/flow-analysis.js';
import type {
  FlowDefinition,
  FlowDefinitionGateway,
  FlowDefinitionLookup,
  FlowMutationOperation,
  FlowVersion,
  FlowVersionNumber,
} from '../../src/types/flow.js';
import { flowMutationPermissionDenied } from '../../src/errors/flow-errors.js';

export interface ActiveVersionUpdate {
  definitionId: string;
  versionNumber: FlowVersionNumber | null;
}

export interface DependencyQuery {
  definitionId: string;
  direction: FlowDependencyQueryDirection;
  types: ReadonlyArray<string>;
}

export interface FlowDefinitionFixture {
  id: string;
  apiName: string;
  activeVersionId: string | null;
  latestVersionId: string | null;
}

export class FakeFlowGateway implements FlowDefinitionGateway {
  public readonly updates: ActiveVersionUpdate[] = [];
  public readonly deletes: string[] = [];
  public readonly dependencies: IndexedFlowDependency[] = [];
  public readonly dependenciesByDefinition = new Map<string, IndexedFlowDependency[]>();
  public readonly dependencyQueries: DependencyQuery[] = [];
  public readonly metadataQueries: string[] = [];
  public readonly truncatedDependencyQueries = new Set<string>();
  public readonly metadata = new Map<string, JsonObject>();
  public readonly permissionChecks: FlowMutationOperation[] = [];
  public readonly versionQueries: string[] = [];
  public allVersionQueries = 0;
  public allowDefinitionUpdates = true;
  public allowVersionDeletes = true;
  public persistUpdates = true;
  public persistDeletes = true;
  public queryError?: Error;
  public mutationError?: Error;
  private definitions: FlowDefinition[];
  private versions: FlowVersion[];

  public constructor(definitions: ReadonlyArray<FlowDefinition>, versions: ReadonlyArray<FlowVersion>) {
    this.definitions = definitions.map((definition) => ({ ...definition }));
    this.versions = versions.map((version) => ({ ...version }));
  }

  public async assertMutationAllowed(operation: FlowMutationOperation): Promise<void> {
    this.permissionChecks.push(operation);
    const allowed = operation === 'update-definition' ? this.allowDefinitionUpdates : this.allowVersionDeletes;
    if (!allowed) {
      throw flowMutationPermissionDenied(
        operation === 'update-definition' ? 'update Flow definitions' : 'delete Flow versions'
      );
    }
  }

  public async findDefinitions(lookup: FlowDefinitionLookup): Promise<ReadonlyArray<FlowDefinition>> {
    this.throwQueryError();
    return this.definitions.filter(
      (definition) =>
        definition.apiName === lookup.apiName &&
        (lookup.namespace === undefined || definition.namespace === lookup.namespace)
    );
  }

  public async findAllDefinitions(): Promise<ReadonlyArray<FlowDefinition>> {
    this.throwQueryError();
    return this.definitions;
  }

  public async findVersions(definitionId: string): Promise<ReadonlyArray<FlowVersion>> {
    this.throwQueryError();
    this.versionQueries.push(definitionId);
    return this.versions.filter((version) => version.definitionId === definitionId);
  }

  public async findAllVersions(): Promise<ReadonlyArray<FlowVersion>> {
    this.throwQueryError();
    this.allVersionQueries += 1;
    return this.versions;
  }

  public async findDependencies(
    definitionId: string,
    direction: FlowDependencyQueryDirection,
    types: ReadonlyArray<string>
  ): Promise<FlowDependencyQueryResult> {
    this.throwQueryError();
    this.dependencyQueries.push({ definitionId, direction, types });
    const dependencies = (this.dependenciesByDefinition.get(definitionId) ?? this.dependencies).filter(
      (dependency) =>
        dependency.direction === direction &&
        (types.length === 0 || (dependency.type !== null && types.includes(dependency.type)))
    );
    return {
      dependencies,
      reachedLimit: this.truncatedDependencyQueries.has(`${definitionId}:${direction}`),
      limit: 2000,
    };
  }

  public async getVersionMetadata(versionId: string): Promise<JsonObject> {
    this.throwQueryError();
    this.metadataQueries.push(versionId);
    const metadata = this.metadata.get(versionId);
    if (metadata === undefined) {
      throw new Error(`Missing fake metadata for version ${versionId}.`);
    }
    return metadata;
  }

  public async setActiveVersion(definitionId: string, versionNumber: FlowVersionNumber | null): Promise<void> {
    this.throwMutationError();
    this.updates.push({ definitionId, versionNumber });
    if (!this.persistUpdates) {
      return;
    }
    const activeVersionId =
      versionNumber === null
        ? null
        : this.versions.find(
            (version) => version.definitionId === definitionId && version.versionNumber === versionNumber
          )?.id ?? null;
    this.definitions = this.definitions.map((definition) =>
      definition.id === definitionId ? { ...definition, activeVersionId } : definition
    );
  }

  public async deleteVersion(versionId: string): Promise<void> {
    this.throwMutationError();
    this.deletes.push(versionId);
    if (this.persistDeletes) {
      this.versions = this.versions.filter((version) => version.id !== versionId);
    }
  }

  private throwQueryError(): void {
    if (this.queryError !== undefined) {
      throw this.queryError;
    }
  }

  private throwMutationError(): void {
    if (this.mutationError !== undefined) {
      throw this.mutationError;
    }
  }
}

export function flowDefinition(fixture: FlowDefinitionFixture): FlowDefinition {
  return { ...fixture, namespace: null };
}

export function flowVersion(definitionId: string, versionNumber: number, status: string): FlowVersion {
  return {
    id: `301${definitionId.slice(3, 14)}${String(versionNumber).padStart(4, '0')}`,
    definitionId,
    versionNumber,
    status,
    label: `Version ${versionNumber}`,
    processType: 'Flow',
    createdDate: `2026-01-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
    lastModifiedDate: `2026-02-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
  };
}

export async function expectErrorName(promise: Promise<unknown>, name: string): Promise<void> {
  try {
    await promise;
    expect.fail(`Expected ${name}.`);
  } catch (error: unknown) {
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).name).to.equal(name);
  }
}
