/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { FlowExportService } from '../../src/services/flow-export-service.js';
import type { FlowExportRequest } from '../../src/types/flow-inspection.js';
import { FakeFlowGateway, flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definitionId = '300000000000001';

function request(): FlowExportRequest {
  return {
    apiName: 'Source_Flow',
    targetOrg: 'admin@example.com',
    version: 2,
    format: 'xml',
    status: 'draft',
    outputFile: '/tmp/Source_Flow.flow-meta.xml',
  };
}

describe('FlowExportService', (): void => {
  it('exports the selected Flow version as Draft XML', async (): Promise<void> => {
    const active = flowVersion(definitionId, 1, 'Active');
    const selected = flowVersion(definitionId, 2, 'Draft');
    const gateway = new FakeFlowGateway(
      [
        flowDefinition({
          id: definitionId,
          apiName: 'Source_Flow',
          activeVersionId: active.id,
          latestVersionId: selected.id,
        }),
      ],
      [active, selected]
    );
    gateway.metadata.set(selected.id, { label: 'Source Flow', status: 'Draft' });
    const artifact = await new FlowExportService(gateway).export(request());
    expect(artifact.content).to.include('<label>Source Flow</label>');
    expect(artifact.result).to.include({
      resolvedVersion: 2,
      sourceStatus: 'Draft',
      exportedStatus: 'Draft',
      bytes: Buffer.byteLength(artifact.content, 'utf8'),
    });
  });
});
