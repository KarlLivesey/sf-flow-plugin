/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { join } from 'node:path';

import { flowBundleFailed } from '../errors/flow-errors.js';
import type { FlowDependencyGateway, FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowBundleArtifact, FlowBundleFile, FlowBundleRequest, FlowBundleVersion } from '../types/flow-bundle.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowDescribeRequest, FlowDescription } from '../types/flow-inspection.js';
import { externalDependencies, renderPackageXml } from '../utils/flow-bundle-manifest.js';
import { noFlowProgress, type FlowProgressReporter } from '../utils/flow-progress.js';
import { FlowDependenciesService } from './flow-dependencies-service.js';
import { FlowDescribeService } from './flow-describe-service.js';
import { FlowExportService } from './flow-export-service.js';

type FlowBundleGateway = FlowDefinitionGateway & FlowDependencyGateway & FlowMetadataGateway;

interface BundleContext {
  gateway: FlowBundleGateway;
  request: FlowBundleRequest;
  progress: FlowProgressReporter;
}

function describeRequest(request: FlowBundleRequest): FlowDescribeRequest {
  return {
    ...request,
    version: request.version,
    subflowVersion: request.subflowVersion,
    recursive: true,
    maxDepth: request.maxDepth,
    sections: [],
  };
}

function flowPath(request: FlowBundleRequest, flow: FlowDescription): string {
  return join(request.outputDir, 'flows', `${flow.qualifiedName}.flow-meta.xml`);
}

async function exportFlows(
  context: BundleContext,
  flows: ReadonlyArray<FlowDescription>
): Promise<{ versions: FlowBundleVersion[]; files: FlowBundleFile[] }> {
  const { gateway, request, progress } = context;
  const artifacts = await flows.reduce(async (previous, flow) => {
    const values = await previous;
    const file = flowPath(request, flow);
    const artifact = await new FlowExportService(gateway).export(
      {
        apiName: flow.apiName,
        targetOrg: request.targetOrg,
        version: flow.versionNumber,
        format: 'xml',
        status: request.status,
        outputFile: file,
        ...(flow.namespace === null ? {} : { namespace: flow.namespace }),
        ...(request.apiVersion === undefined ? {} : { apiVersion: request.apiVersion }),
      },
      progress
    );
    return [...values, { flow, file, artifact }];
  }, Promise.resolve([] as Array<{ flow: FlowDescription; file: string; artifact: Awaited<ReturnType<FlowExportService['export']>> }>));
  return {
    versions: artifacts.map(({ flow, file, artifact }) => ({
      apiName: flow.apiName,
      namespace: flow.namespace,
      qualifiedName: flow.qualifiedName,
      definitionId: flow.definitionId,
      versionId: flow.versionId,
      versionNumber: flow.versionNumber,
      sourceStatus: flow.status,
      exportedStatus: artifact.result.exportedStatus,
      file,
    })),
    files: artifacts.map(({ file, artifact }) => ({ path: file, content: artifact.content })),
  };
}

function reportFiles(
  request: FlowBundleRequest,
  versions: ReadonlyArray<FlowBundleVersion>,
  dependencies: Awaited<ReturnType<FlowDependenciesService['getDependencies']>>
): FlowBundleFile[] {
  const directory = join(request.outputDir, '.sf-flow-bundle');
  const external = externalDependencies(dependencies.dependencies);
  const manifest = {
    apiName: request.apiName,
    requestedVersion: request.version,
    subflowVersion: request.subflowVersion,
    status: request.status,
    flows: versions,
  };
  return [
    { path: join(directory, 'package.xml'), content: renderPackageXml(versions, request.apiVersion ?? '65.0') },
    { path: join(directory, 'manifest.json'), content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: join(directory, 'dependencies.json'), content: `${JSON.stringify(dependencies, null, 2)}\n` },
    { path: join(directory, 'external-dependencies.json'), content: `${JSON.stringify(external, null, 2)}\n` },
  ];
}

async function createBundle(context: BundleContext): Promise<FlowBundleArtifact> {
  const { gateway, request, progress } = context;
  const described = await new FlowDescribeService(gateway).describe(describeRequest(request), progress);
  const dependencies = await new FlowDependenciesService(gateway).getDependencies(
    { ...request, direction: 'uses', recursive: true, maxDepth: request.maxDepth, types: [] },
    progress
  );
  if (dependencies.truncated) {
    throw flowBundleFailed("A dependency query reached Salesforce's 2,000-record cap.");
  }
  const exported = await exportFlows(context, described.flows);
  const files = [...exported.files, ...reportFiles(request, exported.versions, dependencies)];
  return {
    files,
    result: {
      apiName: described.apiName,
      namespace: described.namespace,
      requestedVersion: described.requestedVersion,
      resolvedVersion: described.resolvedVersion,
      subflowVersion: described.subflowVersion,
      maxDepth: described.maxDepth,
      exportedStatus: request.status === 'active' ? 'Active' : 'Draft',
      outputDir: request.outputDir,
      overwrite: request.overwrite,
      flows: exported.versions,
      dependencies: dependencies.dependencies,
      externalDependencies: externalDependencies(dependencies.dependencies),
      warnings: described.warnings,
      outputFiles: files.map((file) => file.path),
      targetOrg: request.targetOrg,
    },
  };
}

export class FlowBundleService {
  public constructor(private readonly gateway: FlowBundleGateway) {}

  public async bundle(
    request: FlowBundleRequest,
    progress: FlowProgressReporter = noFlowProgress
  ): Promise<FlowBundleArtifact> {
    try {
      return await createBundle({ gateway: this.gateway, request, progress });
    } catch (error: unknown) {
      if (error instanceof Error && error.name.startsWith('Flow') && error.name !== 'FlowInspectionFailed') {
        throw error;
      }
      throw flowBundleFailed(`Failed to bundle Flow "${request.apiName}".`, error);
    }
  }
}
