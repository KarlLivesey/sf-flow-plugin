/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { analyseFlowMetadata } from '../../src/utils/flow-metadata-analysis.js';
import { analyseFlowMetrics, totalFlowMetrics } from '../../src/utils/flow-metrics-analysis.js';
import { flowDefinition, flowVersion } from '../helpers/fake-flow-gateway.js';

const definition = flowDefinition({
  id: '300000000000001',
  apiName: 'Metrics_Flow',
  activeVersionId: '301000000000001',
  latestVersionId: '301000000000001',
});
const version = flowVersion(definition.id, 1, 'Active');

describe('Flow metrics analysis', (): void => {
  it('counts structure, paths, fault coverage and lint-derived facts', (): void => {
    const metadata = {
      start: { connector: { targetReference: 'Choose_Path' } },
      decisions: [
        {
          name: 'Choose_Path',
          rules: [{ name: 'Continue', connector: { targetReference: 'Loop_Items' } }],
          defaultConnector: { targetReference: 'Finish' },
        },
      ],
      loops: [{ name: 'Loop_Items', connector: { targetReference: 'Create_Record' } }],
      recordCreates: [
        {
          name: 'Create_Record',
          object: 'Account',
          connector: { targetReference: 'Loop_Items' },
          faultConnector: { targetReference: 'Finish' },
        },
      ],
      assignments: [{ name: 'Finish' }],
      variables: [
        {
          name: 'Unused',
          dataType: 'String',
          isCollection: false,
          isInput: false,
          isOutput: false,
        },
      ],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    const metrics = analyseFlowMetrics(metadata, description);
    expect(metrics).to.include({
      executableElements: 4,
      decisions: 1,
      decisionOutcomes: 1,
      loops: 1,
      maximumLoopNesting: 1,
      dmlElements: 1,
      dmlInsideLoops: 1,
      faultCapableElements: 1,
      faultConnectedElements: 1,
      unusedResources: 1,
      unreachableElements: 0,
    });
    expect(metrics.referencedObjects).to.deep.equal(['Account']);
    expect(totalFlowMetrics([metrics])).to.include({ executableElements: 4, maximumLoopNesting: 1 });
  });
});

describe('Flow metrics path analysis', (): void => {
  it('calculates merged decision paths without enumerating every simple path', (): void => {
    const decisionCount = 25;
    const metadata = {
      start: { connector: { targetReference: 'Decision_0' } },
      decisions: Array.from({ length: decisionCount }, (_unused, index) => ({
        name: `Decision_${index}`,
        rules: [
          {
            name: 'Left',
            connector: { targetReference: `Left_${index}` },
          },
        ],
        defaultConnector: { targetReference: `Right_${index}` },
      })),
      assignments: [
        ...Array.from({ length: decisionCount }, (_unused, index) => ({
          name: `Left_${index}`,
          connector: {
            targetReference: index === decisionCount - 1 ? 'Finish' : `Decision_${index + 1}`,
          },
        })),
        ...Array.from({ length: decisionCount }, (_unused, index) => ({
          name: `Right_${index}`,
          connector: {
            targetReference: index === decisionCount - 1 ? 'Finish' : `Decision_${index + 1}`,
          },
        })),
        { name: 'Finish' },
      ],
    };
    const description = analyseFlowMetadata({ definition, version, metadata, depth: 0 });
    expect(analyseFlowMetrics(metadata, description).maximumPathDepth).to.equal(51);
  });
});
