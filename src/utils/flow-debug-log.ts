/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Buffer } from 'node:buffer';

import { z } from 'zod';

import type { JsonValue } from '../types/flow-analysis.js';
import type { FlowDebugError, FlowDebugEvent } from '../types/flow-debug.js';

export interface ParsedFlowDebugLog {
  events: FlowDebugEvent[];
  interviewId: string | null;
  outputs: Record<string, JsonValue>;
  error: FlowDebugError | null;
  rollbackMarker: boolean;
  endMarker: boolean;
}

interface ParsedLogLine {
  timestamp: string;
  event: string;
  detail?: string;
}

const markerErrorSchema = z.object({
  type: z.string().nullable().optional(),
  message: z.string(),
});
const outputSchema = z.record(z.string(), z.json());
const SAFE_DETAIL_EVENTS = new Set([
  'FLOW_ACTIONCALL_DETAIL',
  'FLOW_BULK_ELEMENT_BEGIN',
  'FLOW_BULK_ELEMENT_END',
  'FLOW_CREATE_INTERVIEW_BEGIN',
  'FLOW_CREATE_INTERVIEW_END',
  'FLOW_ELEMENT_BEGIN',
  'FLOW_ELEMENT_DEFERRED',
  'FLOW_ELEMENT_END',
  'FLOW_ELEMENT_FAULT',
  'FLOW_ELEMENT_LIMIT_USAGE',
  'FLOW_INTERVIEW_FINISHED',
  'FLOW_INTERVIEW_FINISHED_LIMIT_USAGE',
  'FLOW_START_INTERVIEW_BEGIN',
  'FLOW_START_INTERVIEW_END',
  'FLOW_START_INTERVIEW_LIMIT_USAGE',
  'FLOW_START_INTERVIEWS_BEGIN',
  'FLOW_START_INTERVIEWS_END',
]);

function parseLine(line: string): ParsedLogLine | null {
  const separator = line.indexOf('|');
  const remainder = line.slice(separator + 1);
  const eventSeparator = remainder.indexOf('|');
  const event = eventSeparator < 0 ? remainder : remainder.slice(0, eventSeparator);
  if (separator < 0 || !/^[A-Z][A-Z0-9_]*$/u.test(event)) {
    return null;
  }
  return {
    timestamp: line.slice(0, separator),
    event,
    ...(eventSeparator < 0 ? {} : { detail: remainder.slice(eventSeparator + 1) }),
  };
}

function decodeJson(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown;
}

function eventFields(
  event: string,
  detail: string | undefined
): Pick<FlowDebugEvent, 'interviewId' | 'elementType' | 'elementName'> {
  const parts = detail?.split('|') ?? [];
  const hasInterview = event.startsWith('FLOW_ELEMENT_') || event === 'FLOW_START_INTERVIEW_BEGIN';
  const isElement = event === 'FLOW_ELEMENT_BEGIN' || event === 'FLOW_ELEMENT_END';
  return {
    interviewId: hasInterview ? parts[0] ?? null : null,
    elementType: isElement ? parts[1] ?? null : null,
    elementName: isElement ? parts[2] ?? null : null,
  };
}

function displayedDetail(event: string, detail: string | undefined, showValues: boolean): string | null {
  if (detail === undefined || detail.length === 0) {
    return null;
  }
  if (showValues || SAFE_DETAIL_EVENTS.has(event)) {
    return detail;
  }
  if (event === 'FLOW_RULE_DETAIL') {
    const [interviewId, ruleName] = detail.split('|');
    return [interviewId, ruleName, '[REDACTED]'].filter((part) => part !== undefined).join('|');
  }
  return '[REDACTED]';
}

class FlowDebugLogParser {
  private readonly events: FlowDebugEvent[] = [];
  private readonly outputChunks = new Map<number, string>();
  private readonly marker: string;
  private encodedError: string | null = null;
  private rollbackMarker = false;
  private endMarker = false;

  public constructor(correlationId: string, private readonly showValues: boolean) {
    this.marker = `SF_FLOW_PLUGIN_DEBUG|${correlationId}|`;
  }

  public parse(rawLog: string): ParsedFlowDebugLog {
    rawLog.split(/\r?\n/u).forEach((line) => {
      this.accept(line);
    });
    return {
      events: this.events,
      interviewId: this.interviewId(),
      outputs: this.outputs(),
      error: this.error(),
      rollbackMarker: this.rollbackMarker,
      endMarker: this.endMarker,
    };
  }

  private accept(line: string): void {
    const markerIndex = line.indexOf(this.marker);
    if (markerIndex >= 0) {
      this.acceptMarker(line.slice(markerIndex + this.marker.length));
      return;
    }
    this.acceptEvent(line);
  }

  private acceptEvent(line: string): void {
    const parsed = parseLine(line);
    if (parsed === null || !parsed.event.startsWith('FLOW_')) {
      return;
    }
    this.events.push({
      sequence: this.events.length + 1,
      timestamp: parsed.timestamp,
      event: parsed.event,
      ...eventFields(parsed.event, parsed.detail),
      detail: displayedDetail(parsed.event, parsed.detail, this.showValues),
    });
  }

  private acceptMarker(payload: string): void {
    if (payload.startsWith('OUTPUT|')) {
      this.acceptOutput(payload);
    } else if (payload.startsWith('ERROR|')) {
      this.encodedError = payload.slice('ERROR|'.length);
    } else if (payload === 'ROLLBACK') {
      this.rollbackMarker = true;
    } else if (payload === 'END') {
      this.endMarker = true;
    }
  }

  private acceptOutput(payload: string): void {
    const [, index, chunk] = payload.split('|', 3);
    if (index !== undefined && chunk !== undefined && /^\d+$/u.test(index)) {
      this.outputChunks.set(Number(index), chunk);
    }
  }

  private error(): FlowDebugError | null {
    if (this.encodedError === null) {
      return null;
    }
    const parsed = markerErrorSchema.parse(decodeJson(this.encodedError));
    return {
      type: parsed.type ?? null,
      message: this.showValues ? parsed.message : 'Salesforce reported a Flow error; details redacted.',
    };
  }

  private interviewId(): string | null {
    return (
      this.events.find((event) => event.event === 'FLOW_START_INTERVIEW_BEGIN' && event.interviewId !== null)
        ?.interviewId ?? null
    );
  }

  private outputs(): Record<string, JsonValue> {
    const encoded = [...this.outputChunks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, chunk]) => chunk)
      .join('');
    return encoded.length === 0 ? {} : outputSchema.parse(decodeJson(encoded));
  }
}

export function parseFlowDebugLog(rawLog: string, correlationId: string, showValues: boolean): ParsedFlowDebugLog {
  return new FlowDebugLogParser(correlationId, showValues).parse(rawLog);
}
