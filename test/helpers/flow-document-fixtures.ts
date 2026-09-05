/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from '../../src/types/flow-analysis.js';
import type { FlowDocument } from '../../src/types/flow-document.js';
import { analyseFlowMetadata } from '../../src/utils/flow-metadata-analysis.js';
import { flowDefinition, flowVersion } from './fake-flow-gateway.js';

export function documentFixture(metadata: JsonObject = {}, namespace: string | null = 'managed'): FlowDocument {
  const definition = {
    ...flowDefinition({ id: '300000000000001', apiName: 'Root_Flow', activeVersionId: null, latestVersionId: null }),
    namespace,
  };
  const version = flowVersion(definition.id, 1, 'Active');
  const complete = {
    apiVersion: 65,
    label: 'Root Flow',
    processType: 'AutoLaunchedFlow',
    status: 'Active',
    ...metadata,
  };
  return {
    metadata: complete,
    description: analyseFlowMetadata({ definition, version, metadata: complete, depth: 0 }),
    targetOrg: 'admin@example.com',
    sourceFile: null,
  };
}
