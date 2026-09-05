/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { FlowDescription, FlowDescribeSection } from '../types/flow-inspection.js';

function includesSection(sections: ReadonlyArray<FlowDescribeSection>, section: FlowDescribeSection): boolean {
  return sections.length === 0 || sections.includes(section);
}

function selectedVariables(
  flow: FlowDescription,
  sections: ReadonlyArray<FlowDescribeSection>
): FlowDescription['variables'] {
  if (includesSection(sections, 'resources')) {
    return flow.variables;
  }
  return flow.variables.filter(
    (variable) =>
      (includesSection(sections, 'inputs') && variable.input) ||
      (includesSection(sections, 'outputs') && variable.output)
  );
}

export function filterFlowDescriptionSections(
  flow: FlowDescription,
  sections: ReadonlyArray<FlowDescribeSection>
): FlowDescription {
  return {
    ...flow,
    variables: selectedVariables(flow, sections),
    formulas: includesSection(sections, 'resources') ? flow.formulas : [],
    apexActions: includesSection(sections, 'references') ? flow.apexActions : [],
    subflows: includesSection(sections, 'references') ? flow.subflows : [],
    referencedObjects: includesSection(sections, 'references') ? flow.referencedObjects : [],
    elements: includesSection(sections, 'elements') ? flow.elements : [],
    connectors: includesSection(sections, 'elements') ? flow.connectors : [],
  };
}
