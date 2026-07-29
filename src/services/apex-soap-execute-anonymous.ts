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
function isEmptyPlainRecord(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return (prototype === Object.prototype || prototype === null) && Object.keys(value).length === 0;
}

const nullableDiagnosticSchema = z
  .preprocess((value) => (isEmptyPlainRecord(value) ? null : value), z.string().nullable().optional())
  .transform((value) => value ?? null);
const debugLogSchema = z.preprocess(
  (value) => (isEmptyPlainRecord(value) ? '' : value),
  z.string().optional().default('')
);
const executionSchema: z.ZodType<FlowDebugApexResult> = z.object({
  compiled: booleanTextSchema,
  success: booleanTextSchema,
  line: integerTextSchema,
  column: integerTextSchema,
  compileProblem: nullableDiagnosticSchema,
  exceptionMessage: nullableDiagnosticSchema,
  exceptionStackTrace: nullableDiagnosticSchema,
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

export class ApexSoapResponseValidationError extends Error {
  public override readonly cause!: unknown;
  public readonly rawLog!: string;

  public constructor(cause: unknown, rawLog: string) {
    super('Salesforce returned a malformed Apex SOAP execution result.');
    this.name = 'ApexSoapResponseValidationError';
    Object.defineProperties(this, {
      cause: { value: cause, enumerable: false },
      rawLog: { value: rawLog, enumerable: false },
    });
  }
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

function timeoutError(): Error {
  return Object.assign(new Error('The Apex SOAP request timeout expired before the session retry could start.'), {
    name: 'ETIMEDOUT',
  });
}

function remainingTimeout(deadline: number | undefined): number | undefined {
  if (deadline === undefined) {
    return undefined;
  }
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) {
    throw timeoutError();
  }
  return remaining;
}

export class ApexSoapExecuteAnonymous {
  public constructor(private readonly connection: Connection) {}

  public assertAvailable(): void {
    this.auth();
  }

  public async execute(request: ApexSoapExecuteRequest): Promise<ApexSoapExecuteResult> {
    const started = performance.now();
    const deadline =
      request.timeoutMilliseconds === undefined ? undefined : started + Math.max(0, request.timeoutMilliseconds);
    try {
      return await this.send(request, remainingTimeout(deadline), started);
    } catch (error: unknown) {
      if (!invalidSession(error)) {
        throw error;
      }
      remainingTimeout(deadline);
      await this.connection.refreshAuth();
      return this.send(request, remainingTimeout(deadline), started);
    }
  }

  private auth(): { accessToken: string; orgId: string } {
    const fields = this.connection.getAuthInfoFields();
    const accessToken = this.connection.accessToken ?? fields.accessToken;
    return authSchema.parse({
      accessToken,
      orgId: fields.orgId ?? accessToken?.split('!')[0],
    });
  }

  private async send(
    request: ApexSoapExecuteRequest,
    timeoutMilliseconds: number | undefined,
    started: number
  ): Promise<ApexSoapExecuteResult> {
    const auth = this.auth();
    const response = await this.connection.request(
      {
        method: 'POST',
        url: `${this.connection.instanceUrl}/services/Soap/s/${this.connection.getApiVersion()}/${auth.orgId}`,
        body: createApexSoapEnvelope(auth.accessToken, request),
        headers: { 'content-type': 'text/xml', soapaction: 'executeAnonymous' },
      },
      timeoutMilliseconds === undefined ? undefined : { timeout: timeoutMilliseconds }
    );
    const durationMilliseconds = performance.now() - started;
    const fields = responseFields(response);
    const rawLog = debugLogSchema.parse(fields.rawLog);
    const execution = executionSchema.safeParse(fields.result);
    if (!execution.success) {
      throw new ApexSoapResponseValidationError(execution.error, rawLog);
    }
    return {
      execution: execution.data,
      rawLog,
      durationMilliseconds,
    };
  }
}
