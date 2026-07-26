/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { renderFlowMetadataXml } from '../../src/utils/flow-metadata-xml.js';

describe('renderFlowMetadataXml', (): void => {
  it('renders repeated metadata elements and defaults status to the requested value', (): void => {
    const xml = renderFlowMetadataXml(
      {
        fullName: 'Source_Flow-7',
        label: 'Source & Review',
        processMetadataValues: [
          { name: 'BuilderType', value: { stringValue: 'LightningFlowBuilder' } },
          { name: 'CanvasMode', value: { stringValue: 'AUTO_LAYOUT_CANVAS' } },
        ],
        status: 'Active',
      },
      'draft'
    );
    expect(xml).to.include('<label>Source &amp; Review</label>');
    expect(xml.match(/<processMetadataValues>/gu)).to.have.length(2);
    expect(xml).to.include('<status>Draft</status>');
    expect(xml).to.not.include('<fullName>');
  });

  it('renders an active status when requested', (): void => {
    expect(renderFlowMetadataXml({ status: 'Draft' }, 'active')).to.include('<status>Active</status>');
  });
});
