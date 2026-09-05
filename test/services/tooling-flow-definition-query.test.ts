/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';

import { buildDefinitionQuery } from '../../src/services/tooling-flow-definition-gateway.js';

describe('Tooling Flow definition namespace queries', (): void => {
  it('filters explicitly to unmanaged definitions without changing omitted namespace behaviour', (): void => {
    expect(buildDefinitionQuery({ apiName: 'Example', namespace: null })).to.contain('NamespacePrefix = null');
    expect(buildDefinitionQuery({ apiName: 'Example' })).not.to.contain(' AND NamespacePrefix');
  });
});
