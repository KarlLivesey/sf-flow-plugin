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
    code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/u)
      .optional(),
    statusCode: z.union([z.number().int().min(100).max(599), z.string().regex(/^[A-Z][A-Z0-9_]*$/u)]).optional(),
  })
  .passthrough();

const actionResultSchema: z.ZodType<FlowActionResult> = z.object({
  actionName: z.string().optional(),
  errors: z
    .array(actionErrorSchema)
    .nullish()
    .transform((errors) => errors ?? []),
  invocationId: z.string().nullable().optional(),
  isSuccess: z.boolean(),
  outputValues: z.record(z.string(), z.json()).default({}),
  version: z.number().int().positive().optional(),
});

const actionResultsSchema = z.array(actionResultSchema);

function safeTransportCode(error: unknown): string | null {
  const parsed = transportErrorSchema.safeParse(error);
  if (!parsed.success) {
    return null;
  }
  const code = parsed.data.statusCode ?? parsed.data.code;
  return code === undefined ? null : String(code);
}

function invocationFailureMessage(apiName: string, error: unknown): string {
  const code = safeTransportCode(error);
  return `Salesforce could not invoke Flow "${apiName}".${code === null ? '' : ` Status: ${code}.`}`;
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
      throw flowQueryFailed('Could not determine whether the target org is a production org.', error);
    }
  }

  public async assertFlowActionAvailable(apiName: string): Promise<void> {
    try {
      await this.connection.request(this.actionUrl(apiName));
    } catch {
      throw flowInvocationPermissionDenied(apiName);
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
      throw flowInvocationFailed(invocationFailureMessage(apiName, error));
    }
  }

  private actionUrl(apiName: string): string {
    return `/services/data/v${this.connection.getApiVersion()}/actions/custom/flow/${encodeURIComponent(apiName)}`;
  }
}
