/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

import { flowDebugFailed } from '../errors/flow-errors.js';
import type { FlowDebugApexResult, FlowDebugLogLevel } from '../types/flow-debug.js';
import { LOG_LEVELS } from './flow-debug-transport-support.js';

const textSchema = z.union([z.string(), z.number()]).transform(String);
const booleanTextSchema = textSchema.transform((value, context) => {
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  context.addIssue({ code: 'custom', message: 'Expected a SOAP boolean.' });
  return z.NEVER;
});
const integerTextSchema = textSchema.transform(Number).pipe(z.number().int());
const executionSchema: z.ZodType<FlowDebugApexResult> = z.object({
  compiled: booleanTextSchema,
  success: booleanTextSchema,
  line: integerTextSchema,
  column: integerTextSchema,
});
const authSchema = z.object({
  accessToken: z.string().min(1),
  orgId: z.string().regex(/^[a-zA-Z0-9]{15,18}$/u),
});

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  ApexCode: 'Apex_code',
  ApexProfiling: 'Apex_profiling',
  Callout: 'Callout',
  Database: 'Db',
  System: 'System',
  Validation: 'Validation',
  Visualforce: 'Visualforce',
  Workflow: 'Workflow',
};

export interface ApexSoapExecuteRequest {
  apexSource: string;
  logLevel: FlowDebugLogLevel;
  timeoutMilliseconds?: number;
}

export interface ApexSoapExecuteResult {
  execution: FlowDebugApexResult;
  rawLog: string;
  durationMilliseconds: number;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function localChild(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return Object.entries(value).find(([key]) => key.split(':').at(-1) === name)?.[1];
}

function responseFields(response: unknown): { result: unknown; rawLog: unknown } {
  const envelope = localChild(response, 'Envelope');
  const header = localChild(envelope, 'Header');
  const body = localChild(envelope, 'Body');
  return {
    result: localChild(localChild(body, 'executeAnonymousResponse'), 'result'),
    rawLog: localChild(localChild(header, 'DebuggingInfo'), 'debugLog'),
  };
}

function categories(logLevel: FlowDebugLogLevel): string {
  return Object.entries(LOG_LEVELS[logLevel])
    .map(([category, level]) => {
      const soapCategory = CATEGORY_NAMES[category];
      if (soapCategory === undefined) {
        throw flowDebugFailed(`Flow debug log category "${category}" cannot be mapped to Apex SOAP.`);
      }
      return `<apex:categories><apex:category>${xmlEscape(soapCategory)}</apex:category><apex:level>${xmlEscape(
        level
      )}</apex:level></apex:categories>`;
    })
    .join('');
}

export function createApexSoapEnvelope(accessToken: string, request: ApexSoapExecuteRequest): string {
  return `<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:apex="http://soap.sforce.com/2006/08/apex"><env:Header><apex:SessionHeader><apex:sessionId>${xmlEscape(
    accessToken
  )}</apex:sessionId></apex:SessionHeader><apex:DebuggingHeader>${categories(
    request.logLevel
  )}<apex:debugLevel>NONE</apex:debugLevel></apex:DebuggingHeader></env:Header><env:Body><apex:executeAnonymous><apex:apexcode>${xmlEscape(
    request.apexSource
  )}</apex:apexcode></apex:executeAnonymous></env:Body></env:Envelope>`;
}

function invalidSession(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'INVALID_SESSION_ID' ||
      (error.name === 'ERROR_HTTP_500' && error.message.includes('INVALID_SESSION_ID')))
  );
}

export class ApexSoapExecuteAnonymous {
  public constructor(private readonly connection: Connection) {}

  public assertAvailable(): void {
    this.auth();
  }

  public async execute(request: ApexSoapExecuteRequest): Promise<ApexSoapExecuteResult> {
    try {
      return await this.send(request);
    } catch (error: unknown) {
      if (!invalidSession(error)) {
        throw error;
      }
      await this.connection.refreshAuth();
      return this.send(request);
    }
  }

  private auth(): { accessToken: string; orgId: string } {
    const fields = this.connection.getAuthInfoFields();
    return authSchema.parse({
      accessToken: this.connection.accessToken ?? fields.accessToken,
      orgId: fields.orgId ?? this.connection.accessToken?.split('!')[0],
    });
  }

  private async send(request: ApexSoapExecuteRequest): Promise<ApexSoapExecuteResult> {
    const auth = this.auth();
    const started = performance.now();
    const response = await this.connection.request(
      {
        method: 'POST',
        url: `${this.connection.instanceUrl}/services/Soap/s/${this.connection.getApiVersion()}/${auth.orgId}`,
        body: createApexSoapEnvelope(auth.accessToken, request),
        headers: { 'content-type': 'text/xml', soapaction: 'executeAnonymous' },
      },
      request.timeoutMilliseconds === undefined ? undefined : { timeout: request.timeoutMilliseconds }
    );
    const durationMilliseconds = performance.now() - started;
    const fields = responseFields(response);
    return {
      execution: executionSchema.parse(fields.result),
      rawLog: z.string().parse(fields.rawLog),
      durationMilliseconds,
    };
  }
}
