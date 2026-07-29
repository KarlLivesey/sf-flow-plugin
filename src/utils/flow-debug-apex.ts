/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';

import { flowInputInvalid } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';

export interface FlowDebugApexOptions {
  correlationId: string;
  apiName: string;
  namespace: string | null;
  input: JsonObject;
  outputVariables: string[];
}

const OUTPUT_CHUNK_SIZE = 1000;
const MAX_APEX_SOAP_MESSAGE_BYTES = 50 * 1024 * 1024;
const MAX_FLOW_DEBUG_INPUT_BYTES = 256 * 1024;
const MAX_FLOW_DEBUG_APEX_BYTES = 1024 * 1024;
const SOAP_ENVELOPE_RESERVE_BYTES = 4096;

function soapEncodedBytes(value: string): number {
  const escaped = value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
  return Buffer.byteLength(escaped, 'utf8');
}

function apexString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll(/'/gu, "\\'")}'`;
}

function createInterview(options: FlowDebugApexOptions): string {
  const argumentsList =
    options.namespace === null
      ? `${apexString(options.apiName)}, sfFlowInputs`
      : `${apexString(options.namespace)}, ${apexString(options.apiName)}, sfFlowInputs`;
  return `Flow.Interview sfFlowInterview = Flow.Interview.createInterview(${argumentsList});`;
}

function outputStatements(outputVariables: string[]): string {
  return outputVariables
    .map((name) => `sfFlowOutputs.put(${apexString(name)}, sfFlowInterview.getVariableValue(${apexString(name)}));`)
    .join('\n');
}

export function createFlowDebugApex(options: FlowDebugApexOptions): string {
  const encodedInput = Buffer.from(JSON.stringify(options.input), 'utf8').toString('base64');
  return `String sfFlowMarker = ${apexString(`SF_FLOW_PLUGIN_DEBUG|${options.correlationId}`)};
Map<String, Object> sfFlowInputs = (Map<String, Object>) JSON.deserializeUntyped(
  EncodingUtil.base64Decode(${apexString(encodedInput)}).toString()
);
Map<String, Object> sfFlowOutputs = new Map<String, Object>();
Savepoint sfFlowSavepoint = Database.setSavepoint();
try {
  System.debug(LoggingLevel.ERROR, sfFlowMarker + '|BEGIN');
  ${createInterview(options)}
  sfFlowInterview.start();
  ${outputStatements(options.outputVariables)}
  String sfFlowOutput = EncodingUtil.base64Encode(Blob.valueOf(JSON.serialize(sfFlowOutputs)));
  for (Integer sfFlowOffset = 0; sfFlowOffset < sfFlowOutput.length(); sfFlowOffset += ${OUTPUT_CHUNK_SIZE}) {
    Integer sfFlowEnd = Math.min(sfFlowOffset + ${OUTPUT_CHUNK_SIZE}, sfFlowOutput.length());
    System.debug(
      LoggingLevel.ERROR,
      sfFlowMarker + '|OUTPUT|' + String.valueOf(sfFlowOffset / ${OUTPUT_CHUNK_SIZE}) + '|' +
        sfFlowOutput.substring(sfFlowOffset, sfFlowEnd)
    );
  }
} catch (Exception sfFlowException) {
  Map<String, Object> sfFlowError = new Map<String, Object>{
    'type' => sfFlowException.getTypeName(),
    'message' => sfFlowException.getMessage()
  };
  String sfFlowEncodedError = EncodingUtil.base64Encode(Blob.valueOf(JSON.serialize(sfFlowError)));
  System.debug(LoggingLevel.ERROR, sfFlowMarker + '|ERROR|' + sfFlowEncodedError);
} finally {
  Database.rollback(sfFlowSavepoint);
  System.debug(LoggingLevel.ERROR, sfFlowMarker + '|ROLLBACK');
  System.debug(LoggingLevel.ERROR, sfFlowMarker + '|END');
}`;
}

export function createBoundedFlowDebugApex(options: FlowDebugApexOptions): string {
  const inputBytes = Buffer.byteLength(JSON.stringify(options.input), 'utf8');
  if (inputBytes > MAX_FLOW_DEBUG_INPUT_BYTES) {
    throw flowInputInvalid(
      `Flow rollback input contains ${inputBytes} bytes of JSON and exceeds the plugin's 256 KiB Apex heap safety limit.`
    );
  }
  const source = createFlowDebugApex(options);
  const bytes = soapEncodedBytes(source);
  if (bytes > MAX_FLOW_DEBUG_APEX_BYTES) {
    throw flowInputInvalid(
      `Flow rollback input produces ${bytes} bytes of generated Apex and exceeds the plugin's 1 MiB Apex heap safety limit.`
    );
  }
  if (bytes + SOAP_ENVELOPE_RESERVE_BYTES > MAX_APEX_SOAP_MESSAGE_BYTES) {
    throw flowInputInvalid(
      `Flow rollback input produces ${bytes} bytes of generated Apex and exceeds the Salesforce 50 MiB SOAP message limit.`
    );
  }
  return source;
}
