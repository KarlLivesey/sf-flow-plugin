/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flowLintFailed } from '../errors/flow-errors.js';
import type { FlowMetadataGateway } from '../types/flow-analysis.js';
import type { FlowDefinitionGateway } from '../types/flow.js';
import type { FlowLintResult } from '../types/flow-lint.js';
import type { FlowExportRequest } from '../types/flow-inspection.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import type { FlowProgressReporter } from '../utils/flow-progress.js';
import { escapeXml } from '../utils/flow-metadata-xml.js';
import type { FlowLintFinding } from '../types/flow-lint.js';
import type { FlowExportArtifact } from '../types/flow-inspection.js';
import { FlowExportService } from './flow-export-service.js';
import { SalesforceCodeAnalyzerFlowService } from './salesforce-code-analyzer-flow-service.js';

export interface OrgAnalyzerRequest extends Omit<FlowExportRequest, 'status' | 'format' | 'outputFile'> {
  rules: string[];
  excludedRules: string[];
}

function orgResult(identity: FlowExportArtifact['result'], findings: FlowLintFinding[]): FlowLintResult {
  const retained = findings.map((finding) => {
    const copy = { ...finding };
    delete copy.locations;
    return copy;
  });
  const errors = retained.filter((finding) => finding.severity === 'error').length;
  const warnings = retained.filter((finding) => finding.severity === 'warning').length;
  return {
    apiName: identity.apiName,
    namespace: identity.namespace,
    definitionId: identity.definitionId,
    requestedVersion: identity.requestedVersion,
    resolvedVersion: identity.resolvedVersion,
    status: identity.sourceStatus,
    targetOrg: identity.targetOrg,
    findings: retained,
    newFindings: retained,
    baselineFindings: [],
    errors,
    warnings,
    newErrors: errors,
    newWarnings: warnings,
  };
}

async function cleanup(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    throw flowLintFailed(`Flow lint temporary source could not be removed: ${directory}`);
  }
}

/** Analyse a resolved org version using the same Flow Scanner as local source. */
export class FlowOrgAnalyzerService {
  public constructor(
    private readonly gateway: FlowDefinitionGateway & FlowMetadataGateway,
    private readonly analyzer = new SalesforceCodeAnalyzerFlowService(),
    private readonly metadataGateway: FlowMetadataGateway = gateway
  ) {}

  public async lint(request: OrgAnalyzerRequest, progress: FlowProgressReporter): Promise<FlowLintResult> {
    const directory = await mkdtemp(join(tmpdir(), 'sf-flow-org-lint-'));
    const attempt = await this.analyse(request, progress, directory).then(
      (result) => ({ result }),
      (error: unknown) => ({ error })
    );
    try {
      await cleanup(directory);
    } catch (error: unknown) {
      throw flowLintFailed(
        `Flow lint temporary source was retained at: ${directory}`,
        new AggregateError('error' in attempt ? [attempt.error, error] : [error], 'Flow lint cleanup failed.')
      );
    }
    if ('error' in attempt) {
      throw attempt.error instanceof Error
        ? attempt.error
        : flowLintFailed('Flow lint analysis failed.', attempt.error);
    }
    return attempt.result;
  }

  private async analyse(
    request: OrgAnalyzerRequest,
    progress: FlowProgressReporter,
    directory: string
  ): Promise<FlowLintResult> {
    const artifact = await new FlowExportService({
      findDefinitions: (lookup) => this.gateway.findDefinitions(lookup),
      findVersions: (id) => this.gateway.findVersions(id),
      getVersionMetadata: (id) => this.metadataGateway.getVersionMetadata(id),
    }).export({ ...request, status: 'draft', format: 'xml', outputFile: '' }, progress);
    const identity = artifact.result;
    const name = qualifiedFlowName(identity.apiName, identity.namespace);
    const sourceFile = join(directory, `${name}.flow-meta.xml`);
    // Preserve the source status; exporting Draft is a deployment default, not a lint transformation.
    const content = artifact.content.replace(
      /^ {4}<status>Draft<\/status>$/mu,
      () => `    <status>${escapeXml(identity.sourceStatus)}</status>`
    );
    await writeFile(sourceFile, content, { flag: 'wx', mode: 0o600 });
    progress('running-code-analyzer', `${name} v${identity.resolvedVersion}`);
    const findings = await this.analyzer.analyse({
      sourceFile,
      rules: request.rules,
      excludedRules: request.excludedRules,
    });
    return orgResult(identity, findings);
  }
}
