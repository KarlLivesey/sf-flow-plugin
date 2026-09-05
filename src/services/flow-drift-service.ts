/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDocument } from '../types/flow-document.js';
import type { FlowDriftResult, FlowSnapshotResult } from '../types/flow-snapshot.js';
import type { FlowSource } from '../types/flow-source.js';
import { qualifiedFlowName } from '../utils/flow-state.js';
import { canonicalFlowComparisonPair } from '../utils/flow-comparison-canonical.js';
import { compareFlowMetadata } from '../utils/flow-metadata-diff.js';
import { boundedMap } from '../utils/bounded-map.js';

interface DriftContext {
  before: ReadonlyMap<string, FlowSource>;
  after: ReadonlyMap<string, FlowDocument>;
}

async function driftEntry(flow: string, context: DriftContext): Promise<FlowDriftResult['flows'][number]> {
  const before = context.before.get(flow);
  const after = context.after.get(flow);
  if (before === undefined || after === undefined) {
    return { flow, kind: before === undefined ? 'added' : 'missing', changes: [] };
  }
  const pair = await canonicalFlowComparisonPair(before.metadata, after.metadata);
  const changes = compareFlowMetadata(pair.from, pair.to, { includeStatus: true });
  return { flow, kind: changes.length === 0 ? 'unchanged' : 'changed', changes };
}

/** Compare only within the snapshot's recorded selection; never deploy or mutate the org. */
export async function inspectFlowDrift(
  snapshot: { manifest: FlowSnapshotResult; sources: FlowSource[] },
  documents: ReadonlyArray<FlowDocument>,
  targetOrg: string
): Promise<FlowDriftResult> {
  const before = new Map(
    snapshot.sources.map((source) => [qualifiedFlowName(source.apiName, source.namespace), source])
  );
  const after = new Map(documents.map((document) => [document.description.qualifiedName, document]));
  const flows = await boundedMap([...new Set([...before.keys(), ...after.keys()])].sort(), 4, async (flow) =>
    driftEntry(flow, { before, after })
  );
  return {
    snapshotOrg: snapshot.manifest.targetOrg,
    targetOrg,
    different: flows.some((flow) => flow.kind !== 'unchanged'),
    flows,
  };
}
