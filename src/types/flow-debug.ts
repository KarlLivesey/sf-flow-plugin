/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { JsonObject } from './flow-analysis.js';

export type FlowDebugLogLevel = 'basic' | 'detailed' | 'finest';

export interface FlowDebugExecutionRequest {
  apiName: string;
  namespace: string | null;
  input: JsonObject;
  outputVariables: string[];
  logLevel: FlowDebugLogLevel;
  waitMilliseconds?: number;
}

export interface FlowDebugApexResult {
  compiled: boolean;
  success: boolean;
  line: number;
  column: number;
  compileProblem: string | null;
  exceptionMessage: string | null;
  exceptionStackTrace: string | null;
}

export interface FlowDebugLogRecord {
  id: string | null;
  status: string;
  operation: string;
  startTime: string;
  durationMilliseconds: number;
  logLength: number;
}

export interface FlowDebugTransportResult {
  correlationId: string;
  execution: FlowDebugApexResult;
  log: FlowDebugLogRecord;
  rawLog: string;
}

export type FlowDebugTransportStage = 'configuring-debug' | 'executing-apex';

export type FlowDebugTransportProgress = (stage: FlowDebugTransportStage, detail: string) => void;

export interface FlowDebugEvent {
  sequence: number;
  timestamp: string;
  event: string;
  interviewId: string | null;
  elementType: string | null;
  elementName: string | null;
  detail: string | null;
}

export interface FlowDebugError {
  type: string | null;
  message: string;
}

export interface FlowDebugArtifact<Result> {
  result: Result;
  rawLog: string;
}

export interface FlowDebugGateway {
  isProductionOrg(): Promise<boolean>;
  assertDebugAvailable(apiName: string): Promise<void>;
  execute(request: FlowDebugExecutionRequest, progress?: FlowDebugTransportProgress): Promise<FlowDebugTransportResult>;
}
