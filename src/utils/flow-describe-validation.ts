/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowInspectionFailed } from '../errors/flow-errors.js';
import {
  flowDescribeSectionSchema,
  flowSubflowVersionSelectorSchema,
  nonnegativeIntegerSchema,
} from '../schemas/flow.js';
import type { FlowDescribeRequest } from '../types/flow-inspection.js';

export function validateFlowDescribeRequest(request: FlowDescribeRequest): void {
  if (!nonnegativeIntegerSchema.safeParse(request.maxDepth).success) {
    throw flowInspectionFailed('The recursive Flow traversal depth must be a non-negative whole number.');
  }
  if (!flowSubflowVersionSelectorSchema.safeParse(request.subflowVersion).success) {
    throw flowInspectionFailed('The recursive subflow version selector must be active or latest.');
  }
  if (!(request.sections ?? []).every((section) => flowDescribeSectionSchema.safeParse(section).success)) {
    throw flowInspectionFailed('The requested Flow description section is invalid.');
  }
}
