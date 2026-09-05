/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import type { Connection } from '@salesforce/core';
import { z } from 'zod';

import { flowInvocationFailed, flowInvocationPermissionDenied, flowQueryFailed } from '../errors/flow-errors.js';
import type { JsonObject } from '../types/flow-analysis.js';
import type { FlowActionResult, FlowInvocationGateway } from '../types/flow-invocation.js';

const organisationResultSchema = z.object({
  records: z.array(z.object({ IsSandbox: z.boolean() })).min(1),
});

const actionErrorSchema = z.union([
  z.string(),
  z.object({ message: z.string().optional(), statusCode: z.string().optional() }).passthrough(),
]);

const transportErrorSchema = z
  .object({
    code: z.unknown().optional(),
    errorCode: z.unknown().optional(),
    name: z.unknown().optional(),
    statusCode: z.unknown().optional(),
  })
  .passthrough();
const transportCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/u);
const transportStatusSchema = z.union([z.number().int().min(100).max(599), z.string().regex(/^[A-Z][A-Z0-9_]*$/u)]);

const permissionErrorCodes = new Set([
  'FORBIDDEN',
  'INSUFFICIENT_ACCESS',
  'INSUFFICIENT_ACCESS_OR_READONLY',
  'INVALID_SESSION_ID',
  'UNAUTHORIZED',
]);

const actionResultSchema: z.ZodType<FlowActionResult> = z.object({
  actionName: z.string().optional(),
  errors: z
    .array(actionErrorSchema)
    .nullish()
    .transform((errors) => errors ?? []),
  invocationId: z.string().nullable().optional(),
  isSuccess: z.boolean(),
  outputValues: z
    .record(z.string(), z.json())
    .nullish()
    .transform((outputValues) => outputValues ?? {}),
  version: z.number().int().positive(),
});

const actionResultsSchema = z.array(actionResultSchema);

function transportCodes(error: unknown): Array<number | string> {
  const parsed = transportErrorSchema.safeParse(error);
  if (!parsed.success) {
    return [];
  }
  const { code, errorCode, name, statusCode } = parsed.data;
  const safeCode = (candidate: unknown): string[] => {
    const validated = transportCodeSchema.safeParse(candidate);
    return validated.success ? [validated.data] : [];
  };
  const safeStatus = transportStatusSchema.safeParse(statusCode);
  return [
    ...safeCode(errorCode),
    ...(safeStatus.success ? [safeStatus.data] : []),
    ...safeCode(code),
    ...safeCode(name),
  ];
}

function safeTransportCode(error: unknown): string | null {
  const code = transportCodes(error)[0];
  return code === undefined ? null : String(code);
}

function invocationFailureMessage(apiName: string, error: unknown): string {
  const code = safeTransportCode(error);
  return `Salesforce could not invoke Flow "${apiName}".${code === null ? '' : ` Status: ${code}.`}`;
}

function organisationFailureMessage(error: unknown): string {
  const code = safeTransportCode(error);
  return `Could not determine whether the target org is a production org.${code === null ? '' : ` Status: ${code}.`}`;
}

function isPermissionFailure(error: unknown): boolean {
  return transportCodes(error).some(
    (code) => code === 401 || code === 403 || (typeof code === 'string' && permissionErrorCodes.has(code))
  );
}

export class RestFlowInvocationGateway implements FlowInvocationGateway {
  public constructor(private readonly connection: Connection) {}

  public async isProductionOrg(): Promise<boolean> {
    try {
      const result = organisationResultSchema.parse(
        await this.connection.query('SELECT IsSandbox FROM Organization LIMIT 1')
      );
      return result.records[0]?.IsSandbox === false;
    } catch (error: unknown) {
      throw flowQueryFailed(organisationFailureMessage(error));
    }
  }

  public async assertFlowActionAvailable(apiName: string): Promise<void> {
    try {
      await this.connection.request(this.actionUrl(apiName));
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowInvocationPermissionDenied(apiName);
      }
      throw flowInvocationFailed(invocationFailureMessage(apiName, error));
    }
  }

  public async invokeFlow(apiName: string, inputs: ReadonlyArray<JsonObject>): Promise<FlowActionResult[]> {
    try {
      const response: unknown = await this.connection.request({
        method: 'POST',
        url: this.actionUrl(apiName),
        body: JSON.stringify({ inputs }),
      });
      return actionResultsSchema.parse(response);
    } catch (error: unknown) {
      if (isPermissionFailure(error)) {
        throw flowInvocationPermissionDenied(apiName);
      }
      throw flowInvocationFailed(invocationFailureMessage(apiName, error));
    }
  }

  private actionUrl(apiName: string): string {
    return `/services/data/v${this.connection.getApiVersion()}/actions/custom/flow/${encodeURIComponent(apiName)}`;
  }
}
