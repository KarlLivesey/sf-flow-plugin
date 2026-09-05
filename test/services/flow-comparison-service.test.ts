/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from 'chai';

import { FlowComparisonService } from '../../src/services/flow-comparison-service.js';
import { loadFlowSource } from '../../src/services/flow-source-service.js';
import type { FlowCompareRequest, JsonObject } from '../../src/types/flow-analysis.js';
import { renderFlowMetadataXml } from '../../src/utils/flow-metadata-xml.js';
import { noFlowProgress } from '../../src/utils/flow-progress.js';
import { expectErrorName, FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';
const versions = [flowVersion(definitionId, 1, 'Active'), flowVersion(definitionId, 2, 'Draft')];
const canonicalDefinitionId = '300000000000201';
const canonicalVersion = flowVersion(canonicalDefinitionId, 1, 'Draft');
const canonicalMetadata: JsonObject = {
  actionCalls: [
    {
      actionName: 'ExampleAction',
      actionType: 'apex',
      inputParameters: [{ name: 'input', value: { stringValue: 'value' } }],
      isWaitUntilCompleted: true,
      label: 'Call action',
      locationX: 300,
      locationY: 400,
      name: 'Call_Action',
    },
  ],
  apiVersion: 65,
  label: 'Canonical Flow',
  processType: 'AutoLaunchedFlow',
  recordCreates: [
    {
      doesUpsert: true,
      label: 'Create record',
      locationX: 100,
      locationY: 200,
      name: 'Create_Record',
    },
  ],
  screens: [
    {
      fields: [{ dataType: 'String', fieldType: 'InputField', name: 'Input_Field' }],
      label: 'Input screen',
      locationX: 500,
      locationY: 600,
      name: 'Input_Screen',
    },
  ],
  start: {
    inputs: [{ name: 'StartValue', value: { stringValue: 'Example' } }],
    locationX: 0,
    locationY: 0,
  },
  status: 'Draft',
};

function request(overrides: Partial<FlowCompareRequest> = {}): FlowCompareRequest {
  return {
    apiName: 'Order_Processing',
    targetOrg: 'admin@example.com',
    fromOrg: 'admin@example.com',
    toOrg: 'admin@example.com',
    from: 'active',
    to: 'latest',
    scopes: [],
    ignoreOrder: false,
    ignorePaths: [],
    ...overrides,
  };
}

function gateway(activeVersionId: string | null = versions[0]?.id ?? null): FakeFlowGateway {
  const definition = flowDefinition({
    id: definitionId,
    apiName: 'Order_Processing',
    activeVersionId,
    latestVersionId: versions[1]?.id ?? null,
  });
  const fake = new FakeFlowGateway([definition], versions);
  fake.metadata.set(versions[0]?.id ?? '', { status: 'Active', label: 'One' });
  fake.metadata.set(versions[1]?.id ?? '', { status: 'Draft', label: 'Two' });
  return fake;
}

function canonicalGateway(): FakeFlowGateway {
  const fake = new FakeFlowGateway(
    [
      flowDefinition({
        id: canonicalDefinitionId,
        apiName: 'Canonical_Flow',
        activeVersionId: null,
        latestVersionId: canonicalVersion.id,
      }),
    ],
    [canonicalVersion]
  );
  fake.metadata.set(canonicalVersion.id, canonicalMetadata);
  return fake;
}

function managedAndUnmanagedCanonicalGateway(): FakeFlowGateway {
  const managedDefinitionId = '300000000000202';
  const managedVersion = flowVersion(managedDefinitionId, 1, 'Draft');
  const target = new FakeFlowGateway(
    [
      flowDefinition({
        id: canonicalDefinitionId,
        apiName: 'Canonical_Flow',
        activeVersionId: null,
        latestVersionId: canonicalVersion.id,
      }),
      {
        ...flowDefinition({
          id: managedDefinitionId,
          apiName: 'Canonical_Flow',
          activeVersionId: null,
          latestVersionId: managedVersion.id,
        }),
        namespace: 'managed',
      },
    ],
    [canonicalVersion, managedVersion]
  );
  target.metadata.set(canonicalVersion.id, canonicalMetadata);
  target.metadata.set(managedVersion.id, { ...canonicalMetadata, label: 'Managed Flow' });
  return target;
}

async function withCanonicalSource<T>(
  operation: (source: Awaited<ReturnType<typeof loadFlowSource>>) => Promise<T>
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'flow-comparison-source-'));
  const sourceFile = join(directory, 'Canonical_Flow.flow-meta.xml');
  try {
    await writeFile(sourceFile, renderFlowMetadataXml(canonicalMetadata, 'draft'), 'utf8');
    return await operation(await loadFlowSource(sourceFile));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('FlowComparisonService', (): void => {
  it('compares active and latest metadata without lifecycle status noise', async (): Promise<void> => {
    const result = await new FlowComparisonService(gateway()).compare(request());
    expect(result).to.include({ fromVersion: 1, toVersion: 2, changed: 1, different: true });
    expect(result.changes).to.deep.equal([{ kind: 'changed', path: '$.label', before: 'One', after: 'Two' }]);
  });

  it('resolves explicit version numbers', async (): Promise<void> => {
    const result = await new FlowComparisonService(gateway()).compare(request({ from: 2, to: 2 }));
    expect(result).to.include({ fromVersion: 2, toVersion: 2, different: false });
    expect(result.changes).to.deep.equal([]);
  });

  it('excludes ignored paths and their descendants', async (): Promise<void> => {
    const fake = gateway();
    fake.metadata.set(versions[0]?.id ?? '', { status: 'Active', settings: { label: 'One' } });
    fake.metadata.set(versions[1]?.id ?? '', { status: 'Draft', settings: { label: 'Two' } });
    const result = await new FlowComparisonService(fake).compare(request({ ignorePaths: ['$.settings'] }));
    expect(result.changes).to.deep.equal([]);
  });

  it('fails when the Flow has no active version', async (): Promise<void> => {
    await expectErrorName(new FlowComparisonService(gateway(null)).compare(request()), 'FlowComparisonFailed');
  });

  it('fails when an explicit version does not exist', async (): Promise<void> => {
    await expectErrorName(new FlowComparisonService(gateway()).compare(request({ from: 99 })), 'FlowVersionNotFound');
  });
});

describe('FlowComparisonService source-to-org canonical comparison', (): void => {
  it('does not report differences between exported source XML and the same Tooling metadata', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-comparison-source-'));
    const sourceFile = join(directory, 'Canonical_Flow.flow-meta.xml');
    try {
      await writeFile(sourceFile, renderFlowMetadataXml(canonicalMetadata, 'draft'), 'utf8');
      const source = await loadFlowSource(sourceFile);
      const result = await new FlowComparisonService(undefined, canonicalGateway()).compare(
        request({
          apiName: 'Canonical_Flow',
          fromOrg: 'local source',
          toOrg: 'admin@example.com',
          from: 'active',
          to: 'latest',
        }),
        noFlowProgress,
        { from: source }
      );
      expect(result).to.include({ different: false, fromSourceFile: source.sourceFile, toVersion: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('FlowComparisonService source-to-org namespace identity', (): void => {
  it('selects the unmanaged org Flow when the local filename has no namespace', async (): Promise<void> => {
    const target = managedAndUnmanagedCanonicalGateway();
    const result = await withCanonicalSource((source) =>
      new FlowComparisonService(undefined, target).compare(
        request({
          apiName: source.apiName,
          namespace: source.namespace,
          fromOrg: 'local source',
          toOrg: 'admin@example.com',
          to: 'latest',
        }),
        noFlowProgress,
        { from: source }
      )
    );
    expect(target.definitionQueries[0]).to.deep.equal({ apiName: 'Canonical_Flow', namespace: null });
    expect(result).to.include({ namespace: null, toDefinitionId: canonicalDefinitionId });
  });
});

describe('FlowComparisonService cross-org comparisons', (): void => {
  it('resolves and compares the Flow independently in each org', async (): Promise<void> => {
    const source = gateway();
    const targetDefinitionId = '300000000000101';
    const targetVersion = flowVersion(targetDefinitionId, 4, 'Active');
    const target = new FakeFlowGateway(
      [
        flowDefinition({
          id: targetDefinitionId,
          apiName: 'Order_Processing',
          activeVersionId: targetVersion.id,
          latestVersionId: targetVersion.id,
        }),
      ],
      [targetVersion]
    );
    target.metadata.set(targetVersion.id, { status: 'Active', label: 'Target' });
    const result = await new FlowComparisonService(source, target).compare(
      request({
        from: 'latest',
        to: 'active',
        fromOrg: 'developer@example.com',
        toOrg: 'preprod@example.com',
      })
    );
    expect(result).to.include({
      fromDefinitionId: definitionId,
      toDefinitionId: targetDefinitionId,
      fromVersion: 2,
      toVersion: 4,
      crossOrg: true,
    });
  });
});

describe('FlowComparisonService cross-org identity', (): void => {
  it('rejects different qualified Flows resolved independently in each org', async (): Promise<void> => {
    const source = gateway();
    const targetDefinitionId = '300000000000101';
    const targetVersion = flowVersion(targetDefinitionId, 4, 'Active');
    const targetDefinition = {
      ...flowDefinition({
        id: targetDefinitionId,
        apiName: 'Order_Processing',
        activeVersionId: targetVersion.id,
        latestVersionId: targetVersion.id,
      }),
      namespace: 'managed',
    };
    const target = new FakeFlowGateway([targetDefinition], [targetVersion]);
    target.metadata.set(targetVersion.id, { status: 'Active', label: 'Target' });
    await expectErrorName(
      new FlowComparisonService(source, target).compare(
        request({ fromOrg: 'developer@example.com', toOrg: 'preprod@example.com' })
      ),
      'FlowComparisonFailed'
    );
  });
});
