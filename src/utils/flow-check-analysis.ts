/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDependenciesResult } from '../types/flow-analysis.js';
import type { FlowCheckFinding, FlowCheckKind, FlowCheckResult, FlowInputOutputContract } from '../types/flow-check.js';
import type { FlowVersionsResult } from '../types/flow.js';
import type { FlowDescription, FlowTraversalWarning } from '../types/flow-inspection.js';
import type { FlowLintResult } from '../types/flow-inspection.js';
import { qualifiedFlowName } from './flow-state.js';

export const FLOW_CHECK_KINDS: FlowCheckKind[] = ['lint', 'dependencies', 'subflows', 'versions', 'metrics'];

export function selectedFlowChecks(
  requested: ReadonlyArray<FlowCheckKind>,
  excluded: ReadonlyArray<FlowCheckKind>
): FlowCheckKind[] {
  const defaults: FlowCheckKind[] = ['lint', 'dependencies', 'subflows', 'versions'];
  const selected = new Set(requested.length === 0 ? defaults : requested);
  excluded.forEach((check) => selected.delete(check));
  return FLOW_CHECK_KINDS.filter((check) => selected.has(check));
}

function finding(
  base: Pick<FlowCheckFinding, 'apiName' | 'namespace' | 'version' | 'check'>,
  detail: Pick<FlowCheckFinding, 'code' | 'severity' | 'message' | 'path'>
): FlowCheckFinding {
  return { ...base, ...detail };
}

export function lintCheckFindings(result: FlowLintResult, check: 'lint' | 'subflows'): FlowCheckFinding[] {
  const subflowRules = new Set(['inactive-subflow', 'missing-subflow']);
  return result.findings
    .filter((item) => (check === 'subflows' ? subflowRules.has(item.rule) : !subflowRules.has(item.rule)))
    .map((item) =>
      finding(
        {
          apiName: result.apiName,
          namespace: result.namespace,
          version: result.resolvedVersion,
          check,
        },
        { code: item.rule, severity: item.severity, message: item.message, path: item.path ?? item.element }
      )
    );
}

export function traversalCheckFindings(
  flow: { apiName: string; namespace: string | null; version: number },
  warnings: ReadonlyArray<FlowTraversalWarning>
): FlowCheckFinding[] {
  return warnings.map((warning) =>
    finding(
      { ...flow, check: 'subflows' },
      {
        code: warning.kind,
        severity: warning.kind === 'subflow-version-fallback' ? 'warning' : 'error',
        message: `${warning.kind}: ${warning.path.join(' -> ')}`,
        path: warning.path.join(' -> '),
      }
    )
  );
}

export function dependencyCheckFindings(result: FlowDependenciesResult, allowTruncated: boolean): FlowCheckFinding[] {
  const missing = result.dependencies.filter(
    (dependency) => dependency.componentId === null || dependency.name === null || dependency.type === null
  );
  const missingFindings = missing.map((dependency) =>
    finding(
      { apiName: result.apiName, namespace: result.namespace, version: null, check: 'dependencies' },
      {
        code: 'missing-dependency-reference',
        severity: 'error',
        message: 'Salesforce returned an incomplete metadata dependency reference.',
        path: dependency.name,
      }
    )
  );
  const truncations = result.truncations.map((truncation) =>
    finding(
      { apiName: result.apiName, namespace: result.namespace, version: null, check: 'dependencies' },
      {
        code: 'dependency-results-truncated',
        severity: allowTruncated ? 'warning' : 'error',
        message: `${truncation.direction} dependencies reached ${truncation.limit} records at depth ${truncation.depth}.`,
        path: null,
      }
    )
  );
  return [...missingFindings, ...truncations];
}

export function versionCheckFindings(result: FlowVersionsResult): FlowCheckFinding[] {
  const base = {
    apiName: result.apiName,
    namespace: result.namespace,
    version: result.latestVersion,
    check: 'versions',
  } as const;
  const inactive = result.versions.filter((version) => !version.active).length;
  return [
    ...(result.activeVersion === null
      ? [
          finding(base, {
            code: 'no-active-version',
            severity: 'error',
            message: 'No Flow version is active.',
            path: null,
          }),
        ]
      : []),
    ...(result.activeVersion !== null && result.latestVersion !== null && result.activeVersion < result.latestVersion
      ? [
          finding(base, {
            code: 'active-version-behind-latest',
            severity: 'warning',
            message: `Active version ${result.activeVersion} is behind latest version ${result.latestVersion}.`,
            path: null,
          }),
        ]
      : []),
    ...(inactive > 5
      ? [
          finding(base, {
            code: 'inactive-version-accumulation',
            severity: 'warning',
            message: `${inactive} inactive Flow versions have accumulated.`,
            path: null,
          }),
        ]
      : []),
  ];
}

export function flowContracts(descriptions: ReadonlyArray<FlowDescription>): FlowInputOutputContract[] {
  return descriptions.map((flow) => ({
    apiName: flow.apiName,
    namespace: flow.namespace,
    version: flow.versionNumber,
    inputs: flow.variables.filter((variable) => variable.input),
    outputs: flow.variables.filter((variable) => variable.output),
  }));
}

export function formatFlowCheckHuman(result: FlowCheckResult): string {
  const lines = result.findings.map(
    (item) =>
      `${item.severity.toUpperCase()}\t${qualifiedFlowName(item.apiName, item.namespace)}\t${item.check}\t${
        item.code
      }\t${item.path ?? '-'}\t${item.message}`
  );
  return [`Flow check (${result.errors} errors, ${result.warnings} warnings)`, ...lines].join('\n');
}

function sarifLocation(item: FlowCheckFinding): object {
  const flowName = qualifiedFlowName(item.apiName, item.namespace);
  return {
    logicalLocations: [
      { name: flowName, fullyQualifiedName: flowName, kind: 'flow' },
      ...(item.path === null
        ? []
        : [
            {
              name: item.path,
              fullyQualifiedName: `${flowName}:${item.path}`,
              kind: 'flowElementOrMetadataPath',
            },
          ]),
    ],
    properties: {
      flowApiName: flowName,
      ...(item.path === null ? {} : { metadataPath: item.path }),
    },
  };
}

export function formatFlowCheckSarif(result: FlowCheckResult): string {
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: { driver: { name: 'sf-flow-plugin flow check' } },
          results: result.findings.map((item) => ({
            ruleId: `${item.check}/${item.code}`,
            level: item.severity,
            message: { text: item.message },
            locations: [sarifLocation(item)],
          })),
        },
      ],
    },
    null,
    2
  );
}
