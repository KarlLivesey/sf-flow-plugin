/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject, JsonPrimitive, JsonValue } from '../types/flow-analysis.js';
import type { FlowExportStatus } from '../types/flow-inspection.js';

const XML_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/u;
const INDENT = '    ';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function scalar(value: JsonPrimitive): string {
  return value === null ? '' : escapeXml(String(value));
}

function assertElementName(name: string): void {
  if (!XML_NAME_PATTERN.test(name)) {
    throw new Error(`Flow metadata contains invalid XML element name "${name}".`);
  }
}

function renderValue(name: string, value: JsonValue, depth: number): string[] {
  assertElementName(name);
  if (value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => renderValue(name, item, depth));
  }
  const indentation = INDENT.repeat(depth);
  if (typeof value !== 'object') {
    return [`${indentation}<${name}>${scalar(value)}</${name}>`];
  }
  const children = Object.entries(value).flatMap(([childName, child]) => renderValue(childName, child, depth + 1));
  return children.length === 0
    ? [`${indentation}<${name}/>`]
    : [`${indentation}<${name}>`, ...children, `${indentation}</${name}>`];
}

function sourceMetadata(metadata: JsonObject, status?: FlowExportStatus): JsonObject {
  const source = { ...metadata };
  delete source.fullName;
  if (status !== undefined) {
    source.status = status === 'active' ? 'Active' : 'Draft';
  }
  return source;
}

function renderMetadata(metadata: JsonObject, status?: FlowExportStatus): string {
  const lines = Object.entries(sourceMetadata(metadata, status)).flatMap(([name, value]) =>
    renderValue(name, value, 1)
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Flow xmlns="http://soap.sforce.com/2006/04/metadata">',
    ...lines,
    '</Flow>',
    '',
  ].join('\n');
}

export function renderFlowMetadataXml(metadata: JsonObject, status: FlowExportStatus): string {
  return renderMetadata(metadata, status);
}

export function renderFlowMetadataXmlForComparison(metadata: JsonObject): string {
  return renderMetadata(metadata);
}
