/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'chai';
import FlowCompare from '../../src/commands/flow/compare.js';
import { FlowComparisonService } from '../../src/services/flow-comparison-service.js';
import { loadFlowSource } from '../../src/services/flow-source-service.js';
import type { FlowCompareRequest, JsonObject } from '../../src/types/flow-analysis.js';
import { renderFlowMetadataXmlForComparison } from '../../src/utils/flow-metadata-xml.js';
import { noFlowProgress } from '../../src/utils/flow-progress.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const input = { name: 'Value', dataType: 'String', isInput: true, isOutput: false, isCollection: false };
const request: FlowCompareRequest = {
  apiName: 'Root',
  from: 1,
  to: 2,
  targetOrg: 'org',
  fromOrg: 'org',
  toOrg: 'org',
  scopes: [],
  ignoreOrder: false,
  ignorePaths: [],
  interfaceOnly: true,
};

function metadata(variables: JsonObject[]): JsonObject {
  return { label: 'Root', processType: 'AutoLaunchedFlow', status: 'Draft', variables };
}

function fakeGateway(before: JsonObject, after: JsonObject): FakeFlowGateway {
  const id = '300000000000001';
  const first = flowVersion(id, 1, 'Active');
  const second = flowVersion(id, 2, 'Draft');
  const gateway = new FakeFlowGateway(
    [flowDefinition({ id, apiName: 'Root', activeVersionId: first.id, latestVersionId: second.id })],
    [first, second]
  );
  gateway.metadata.set(first.id, before);
  gateway.metadata.set(second.id, after);
  return gateway;
}

async function source(directory: string, side: string, value: JsonObject): Promise<string> {
  await mkdir(join(directory, side), { recursive: true });
  const file = join(directory, side, 'Root.flow-meta.xml');
  await writeFile(file, renderFlowMetadataXmlForComparison(value));
  return file;
}

async function assertComparisonPaths(directory: string, after: JsonObject, expected: boolean): Promise<void> {
  const before = metadata([input]);
  const from = await loadFlowSource(await source(directory, 'from', before));
  const to = await loadFlowSource(await source(directory, 'to', after));
  const service = new FlowComparisonService(fakeGateway(before, after));
  await Promise.all(
    [{ from, to }, { from }, { to }, {}].map(async (sources) => {
      const result = await service.compare(request, noFlowProgress, sources);
      expect(result.different, JSON.stringify(Object.keys(sources))).to.equal(expected);
    })
  );
}

describe('Public interfaces across local and org operands', (): void => {
  let directory: string;
  beforeEach(async (): Promise<void> => {
    directory = await mkdtemp(join(tmpdir(), 'flow interfaces '));
  });
  afterEach(async (): Promise<void> => {
    process.exitCode = 0;
    await rm(directory, { recursive: true, force: true });
  });

  for (const [name, variables] of Object.entries({
    removal: [],
    type: [{ ...input, dataType: 'Number' }],
    direction: [{ ...input, isInput: false, isOutput: true }],
    collection: [{ ...input, isCollection: true }],
    private: [{ ...input, isInput: false, isOutput: false }],
  })) {
    it('detects ' + name + ' changes in all four comparison paths', async (): Promise<void> => {
      await assertComparisonPaths(directory, metadata(variables), true);
    });
  }

  it('keeps false-valued private variables out of the interface', async (): Promise<void> => {
    await assertComparisonPaths(directory, metadata([input, { ...input, name: 'Private', isInput: false }]), false);
  });

  it('sets the CLI failure exit code for a removed local input', async (): Promise<void> => {
    const from = await source(directory, 'from', metadata([input]));
    const to = await source(directory, 'to', metadata([]));
    const result = await FlowCompare.run([
      '--from-file',
      from,
      '--to-file',
      to,
      '--interface-only',
      '--fail-on-difference',
      '--json',
    ]);
    expect(result.different).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });
});
