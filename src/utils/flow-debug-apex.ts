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
const MAX_EXECUTE_ANONYMOUS_URI_BYTES = 12_000;

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
  const source = createFlowDebugApex(options);
  const uri = `/executeAnonymous?anonymousBody=${encodeURIComponent(source)}`;
  const bytes = Buffer.byteLength(uri, 'utf8');
  if (bytes > MAX_EXECUTE_ANONYMOUS_URI_BYTES) {
    throw flowInputInvalid(
      `Flow rollback input produces a ${bytes}-byte Execute Anonymous URI; the safe maximum is ${MAX_EXECUTE_ANONYMOUS_URI_BYTES} bytes.`
    );
  }
  return source;
}
