/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flowApiNameSchema, namespaceSchema } from '../schemas/flow.js';
import type { FlowDefinitionLookup } from '../types/flow.js';
import type { FlowDescribeRequest } from '../types/flow-inspection.js';

export function flowDefinitionLookupForRequest(request: FlowDescribeRequest): FlowDefinitionLookup {
  return request.namespace === undefined
    ? { apiName: request.apiName }
    : { apiName: request.apiName, namespace: request.namespace };
}

export function flowDefinitionLookupForSubflow(flowName: string): FlowDefinitionLookup | null {
  const separator = flowName.indexOf('__');
  const apiName = separator < 0 ? flowName : flowName.slice(separator + 2);
  const namespace = separator < 0 ? undefined : flowName.slice(0, separator);
  if (
    !flowApiNameSchema.safeParse(apiName).success ||
    (namespace !== undefined && !namespaceSchema.safeParse(namespace).success)
  ) {
    return null;
  }
  return namespace === undefined ? { apiName } : { apiName, namespace };
}
