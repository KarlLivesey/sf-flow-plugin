/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { resolveFlowVersion } from '../../src/utils/resolve-flow-version.js';
import type { FlowVersion } from '../../src/types/flow.js';

function version(versionNumber: number, status = 'Draft'): FlowVersion {
  return {
    id: `30100000000000${versionNumber}`,
    definitionId: '300000000000001',
    versionNumber,
    status,
    label: `Version ${versionNumber}`,
    processType: 'Flow',
    createdDate: `2026-01-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
    lastModifiedDate: `2026-02-${String(versionNumber).padStart(2, '0')}T00:00:00.000Z`,
  };
}

describe('resolveFlowVersion', (): void => {
  it('selects the highest version for latest', (): void => {
    const selected = resolveFlowVersion('Order_Processing', 'latest', [version(2), version(1), version(3)]);
    expect(selected.versionNumber).to.equal(3);
  });

  it('selects the highest eligible version for latest', (): void => {
    const selected = resolveFlowVersion('Order_Processing', 'latest', [version(2), version(3, 'Obsolete')]);
    expect(selected.versionNumber).to.equal(2);
  });

  it('selects an explicit existing version', (): void => {
    const selected = resolveFlowVersion('Order_Processing', 2, [version(1), version(2)]);
    expect(selected.versionNumber).to.equal(2);
  });

  it('rejects a missing explicit version', (): void => {
    expect(() => resolveFlowVersion('Order_Processing', 4, [version(1)]))
      .to.throw()
      .with.property('name', 'FlowVersionNotFound');
  });

  it('rejects an empty version collection', (): void => {
    expect(() => resolveFlowVersion('Order_Processing', 'latest', []))
      .to.throw()
      .with.property('name', 'FlowVersionNotFound');
  });

  it('rejects duplicate version numbers', (): void => {
    expect(() => resolveFlowVersion('Order_Processing', 'latest', [version(1), version(1)]))
      .to.throw()
      .with.property('name', 'FlowActivationFailed');
  });

  it('rejects an ineligible status', (): void => {
    expect(() => resolveFlowVersion('Order_Processing', 1, [version(1, 'Obsolete')]))
      .to.throw()
      .with.property('name', 'FlowVersionNotActivatable');
  });

  it('does not mutate the supplied versions', (): void => {
    const versions = Object.freeze([Object.freeze(version(2)), Object.freeze(version(1))]);
    resolveFlowVersion('Order_Processing', 'latest', versions);
    expect(versions.map((item) => item.versionNumber)).to.deep.equal([2, 1]);
  });
});
