/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { FLOW_GRAPH_NAMED_COLORS, type FlowGraphNamedColor } from '../constants/flow-graph-colors.js';
import type {
  FlowElementSummary,
  FlowGraphColor,
  FlowGraphColorRole,
  FlowGraphStyle,
} from '../types/flow-inspection.js';

export type FlowGraphStyleCategory = 'action' | 'decision' | 'node' | 'record' | 'screen' | 'start' | 'subflow';

export interface FlowGraphColorPair {
  fill: string;
  stroke: string;
}

export interface ResolvedFlowGraphTheme {
  background: string;
  call: string;
  cluster: FlowGraphColorPair;
  connector: string;
  connectorKind: Record<'default' | 'fault' | 'outcome', string>;
  node: Record<FlowGraphStyleCategory, FlowGraphColorPair>;
  resource: FlowGraphColorPair;
  text: string;
}

export const FLOW_GRAPH_COLOR_ROLES: FlowGraphColorRole[] = [
  'background',
  'cluster',
  'text',
  'node',
  'start',
  'decision',
  'subflow',
  'action',
  'record',
  'screen',
  'resource',
  'connector',
  'call',
  'outcome',
  'default',
  'fault',
];

const DEFAULT_ROLES: Record<FlowGraphColorRole, FlowGraphColor> = {
  background: 'white',
  cluster: 'slate',
  text: 'slate',
  node: 'slate',
  start: 'green',
  decision: 'amber',
  subflow: 'purple',
  action: 'blue',
  record: 'cyan',
  screen: 'pink',
  resource: 'orange',
  connector: 'slate',
  call: 'purple',
  outcome: 'green',
  default: 'amber',
  fault: 'red',
};

function expandHex(value: `#${string}`): string {
  return value.length === 4
    ? `#${value
        .slice(1)
        .split('')
        .map((character) => character.repeat(2))
        .join('')}`.toUpperCase()
    : value.toUpperCase();
}

function lighten(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const lightened = channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
  return `#${lightened}`.toUpperCase();
}

function isHexColor(color: FlowGraphColor): color is `#${string}` {
  return color.startsWith('#');
}

function colorPair(color: FlowGraphColor): FlowGraphColorPair {
  const stroke = isHexColor(color) ? expandHex(color) : FLOW_GRAPH_NAMED_COLORS[color as FlowGraphNamedColor];
  return { fill: lighten(stroke, 0.88), stroke };
}

function directColor(color: FlowGraphColor): string {
  return isHexColor(color) ? expandHex(color) : FLOW_GRAPH_NAMED_COLORS[color as FlowGraphNamedColor];
}

export function resolveGraphTheme(style: FlowGraphStyle): ResolvedFlowGraphTheme {
  const role = { ...DEFAULT_ROLES, ...style.colors };
  return {
    background: directColor(role.background),
    call: directColor(role.call),
    cluster: colorPair(role.cluster),
    connector: directColor(role.connector),
    connectorKind: {
      default: directColor(role.default),
      fault: directColor(role.fault),
      outcome: directColor(role.outcome),
    },
    node: {
      action: colorPair(role.action),
      decision: colorPair(role.decision),
      node: colorPair(role.node),
      record: colorPair(role.record),
      screen: colorPair(role.screen),
      start: colorPair(role.start),
      subflow: colorPair(role.subflow),
    },
    resource: colorPair(role.resource),
    text: directColor(role.text),
  };
}

export function elementStyleCategory(element: FlowElementSummary): FlowGraphStyleCategory {
  if (element.type === 'Start' || element.type === 'Decision' || element.type === 'Subflow') {
    return element.type.toLowerCase() as 'decision' | 'start' | 'subflow';
  }
  if (element.type === 'Action' || element.type === 'Apex Plugin') {
    return 'action';
  }
  if (element.type.startsWith('Record ')) {
    return 'record';
  }
  return element.type === 'Screen' ? 'screen' : 'node';
}
