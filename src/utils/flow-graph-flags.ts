/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import { Flags } from '@salesforce/sf-plugins-core';

import { parseInspectionVersionSelector } from '../commands/flow/describe.js';
import type { FlowComparisonVersionSelector } from '../types/flow-analysis.js';
import type {
  FlowGraphCurve,
  FlowGraphDirection,
  FlowGraphElkCycleBreaking,
  FlowGraphElkModelOrder,
  FlowGraphElkNodePlacement,
  FlowGraphFormat,
  FlowGraphLayout,
  FlowSubflowVersionSelector,
} from '../types/flow-inspection.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-flow-plugin', 'flow.graph');

export const flowGraphFlags = {
  'api-name': Flags.string({
    char: 'n',
    exactlyOne: ['api-name', 'source-file'],
    summary: messages.getMessage('flags.api-name.summary'),
  }),
  'source-file': Flags.file({
    exactlyOne: ['api-name', 'source-file'],
    exists: true,
    summary: messages.getMessage('flags.source-file.summary'),
  }),
  'target-org': Flags.optionalOrg({
    char: 'o',
    summary: messages.getMessage('flags.target-org.summary'),
  }),
  'flow-version': Flags.custom<FlowComparisonVersionSelector>({
    default: 'latest',
    summary: messages.getMessage('flags.flow-version.summary'),
    parse: (input: string): Promise<FlowComparisonVersionSelector> =>
      Promise.resolve(parseInspectionVersionSelector(input)),
  })(),
  'subflow-version': Flags.custom<FlowSubflowVersionSelector>({
    default: 'active',
    options: ['active', 'latest'],
    summary: messages.getMessage('flags.subflow-version.summary'),
    parse: (input: string): Promise<FlowSubflowVersionSelector> =>
      Promise.resolve(input === 'latest' ? 'latest' : 'active'),
  })(),
  format: Flags.custom<FlowGraphFormat>({
    char: 'f',
    default: 'mermaid',
    options: ['mermaid', 'dot'],
    summary: messages.getMessage('flags.format.summary'),
    parse: (input: string): Promise<FlowGraphFormat> => Promise.resolve(input === 'dot' ? 'dot' : 'mermaid'),
  })(),
  recursive: Flags.boolean({
    char: 'r',
    default: false,
    summary: messages.getMessage('flags.recursive.summary'),
  }),
  'max-depth': Flags.integer({
    default: 10,
    min: 0,
    summary: messages.getMessage('flags.max-depth.summary'),
  }),
  'include-variables': Flags.boolean({
    default: false,
    summary: messages.getMessage('flags.include-variables.summary'),
  }),
  'include-formulas': Flags.boolean({
    default: false,
    summary: messages.getMessage('flags.include-formulas.summary'),
  }),
  direction: Flags.custom<FlowGraphDirection>({
    default: 'auto',
    options: ['auto', 'left-right', 'top-down'],
    summary: messages.getMessage('flags.direction.summary'),
    parse: (input: string): Promise<FlowGraphDirection> => Promise.resolve(input as FlowGraphDirection),
  })(),
  layout: Flags.custom<FlowGraphLayout>({
    default: ['auto'],
    multiple: true,
    options: ['auto', 'dagre', 'elk'],
    summary: messages.getMessage('flags.layout.summary'),
    parse: (input: string): Promise<FlowGraphLayout> => Promise.resolve(input as FlowGraphLayout),
  })(),
  curve: Flags.custom<FlowGraphCurve>({
    default: 'auto',
    options: ['auto', 'basis', 'linear', 'step', 'step-after', 'step-before'],
    summary: messages.getMessage('flags.curve.summary'),
    parse: (input: string): Promise<FlowGraphCurve> => Promise.resolve(input as FlowGraphCurve),
  })(),
  'node-placement': Flags.custom<FlowGraphElkNodePlacement>({
    default: 'auto',
    options: ['auto', 'brandes-koepf', 'linear-segments', 'network-simplex', 'simple'],
    summary: messages.getMessage('flags.node-placement.summary'),
    parse: (input: string): Promise<FlowGraphElkNodePlacement> => Promise.resolve(input as FlowGraphElkNodePlacement),
  })(),
  'model-order': Flags.custom<FlowGraphElkModelOrder>({
    default: 'auto',
    options: ['auto', 'none', 'nodes-and-edges', 'prefer-edges', 'prefer-nodes'],
    summary: messages.getMessage('flags.model-order.summary'),
    parse: (input: string): Promise<FlowGraphElkModelOrder> => Promise.resolve(input as FlowGraphElkModelOrder),
  })(),
  'cycle-breaking': Flags.custom<FlowGraphElkCycleBreaking>({
    default: 'auto',
    options: ['auto', 'depth-first', 'greedy', 'greedy-model-order', 'interactive', 'model-order'],
    summary: messages.getMessage('flags.cycle-breaking.summary'),
    parse: (input: string): Promise<FlowGraphElkCycleBreaking> => Promise.resolve(input as FlowGraphElkCycleBreaking),
  })(),
  'merge-edges': Flags.boolean({
    allowNo: true,
    default: false,
    summary: messages.getMessage('flags.merge-edges.summary'),
  }),
  'force-node-order': Flags.boolean({
    allowNo: true,
    default: false,
    summary: messages.getMessage('flags.force-node-order.summary'),
  }),
  'node-spacing': Flags.integer({
    default: 35,
    min: 10,
    max: 200,
    summary: messages.getMessage('flags.node-spacing.summary'),
  }),
  'rank-spacing': Flags.integer({
    default: 45,
    min: 10,
    max: 200,
    summary: messages.getMessage('flags.rank-spacing.summary'),
  }),
  legend: Flags.boolean({
    default: false,
    summary: messages.getMessage('flags.legend.summary'),
  }),
  'label-width': Flags.integer({
    default: 32,
    min: 12,
    max: 80,
    summary: messages.getMessage('flags.label-width.summary'),
  }),
  color: Flags.string({
    aliases: ['colour'],
    multiple: true,
    summary: messages.getMessage('flags.color.summary'),
  }),
  'font-family': Flags.string({
    default: 'Arial',
    summary: messages.getMessage('flags.font-family.summary'),
  }),
  'font-size': Flags.integer({
    default: 14,
    min: 8,
    max: 32,
    summary: messages.getMessage('flags.font-size.summary'),
  }),
  'output-file': Flags.string({
    summary: messages.getMessage('flags.output-file.summary'),
  }),
  namespace: Flags.string({
    summary: messages.getMessage('flags.namespace.summary'),
  }),
  'api-version': Flags.orgApiVersion({
    summary: messages.getMessage('flags.api-version.summary'),
  }),
};
