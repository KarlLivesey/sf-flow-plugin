/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from './flow-analysis.js';
import type { FlowDescription } from './flow-inspection.js';

export interface FlowSource {
  apiName: string;
  namespace: string | null;
  sourceFile: string;
  metadata: JsonObject;
  description: FlowDescription;
}
