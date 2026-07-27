/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import type { FlowDebugApexResult, FlowDebugLogLevel } from '../types/flow-debug.js';

const salesforceIdSchema = z.string().regex(/^[a-zA-Z0-9]{15,18}$/u);

export const identitySchema = z.object({ id: z.url() }).transform((identity) => {
  const userId = new URL(identity.id).pathname.split('/').filter(Boolean).at(-1);
  return { userId: salesforceIdSchema.parse(userId) };
});

export const organisationResultSchema = z.object({
  records: z.array(z.object({ IsSandbox: z.boolean() })).min(1),
});

export const saveResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), id: z.string().min(1), errors: z.array(z.never()) }),
  z.object({
    success: z.literal(false),
    errors: z.array(z.object({ errorCode: z.string(), message: z.string() })),
  }),
]);

export const deleteResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), id: z.string().optional(), errors: z.array(z.never()) }),
  z.object({
    success: z.literal(false),
    errors: z.array(z.object({ errorCode: z.string(), message: z.string() })),
  }),
]);

export const traceFlagQuerySchema = z.object({
  records: z.array(
    z.object({
      Id: z.string(),
      DebugLevelId: z.string(),
      StartDate: z.string(),
      ExpirationDate: z.string(),
    })
  ),
});

export const apexLogQuerySchema = z.object({
  records: z.array(
    z.object({
      Id: z.string(),
      Status: z.string(),
      Operation: z.string(),
      StartTime: z.string(),
      DurationMilliseconds: z.number(),
      LogLength: z.number(),
    })
  ),
});

export const apexExecutionSchema: z.ZodType<FlowDebugApexResult> = z.object({
  compiled: z.boolean(),
  success: z.boolean(),
  line: z.number().int(),
  column: z.number().int(),
});

export const LOG_LEVELS: Readonly<Record<FlowDebugLogLevel, Readonly<Record<string, string>>>> = {
  basic: {
    ApexCode: 'WARN',
    ApexProfiling: 'NONE',
    Callout: 'WARN',
    Database: 'WARN',
    System: 'WARN',
    Validation: 'WARN',
    Visualforce: 'NONE',
    Workflow: 'INFO',
  },
  detailed: {
    ApexCode: 'DEBUG',
    ApexProfiling: 'INFO',
    Callout: 'INFO',
    Database: 'INFO',
    System: 'DEBUG',
    Validation: 'INFO',
    Visualforce: 'INFO',
    Workflow: 'FINER',
  },
  finest: {
    ApexCode: 'FINEST',
    ApexProfiling: 'FINEST',
    Callout: 'FINEST',
    Database: 'FINEST',
    System: 'FINEST',
    Validation: 'FINEST',
    Visualforce: 'FINEST',
    Workflow: 'FINEST',
  },
};

const permissionCodes = new Set([
  'FORBIDDEN',
  'INSUFFICIENT_ACCESS',
  'INSUFFICIENT_ACCESS_OR_READONLY',
  'INVALID_SESSION_ID',
  'UNAUTHORIZED',
]);

export function transportCodes(error: unknown): string[] {
  const parsed = z
    .object({
      code: z.unknown().optional(),
      errorCode: z.unknown().optional(),
      name: z.unknown().optional(),
      statusCode: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(error);
  if (!parsed.success) {
    return [];
  }
  return [parsed.data.errorCode, parsed.data.statusCode, parsed.data.code, parsed.data.name]
    .filter((candidate): candidate is string | number => typeof candidate === 'string' || typeof candidate === 'number')
    .map(String)
    .filter((candidate) => /^\d{3}$/u.test(candidate) || /^[A-Z][A-Z0-9_]*$/u.test(candidate));
}

export function isPermissionFailure(error: unknown): boolean {
  return transportCodes(error).some((code) => code === '401' || code === '403' || permissionCodes.has(code));
}

export function isPermissionCode(code: string | undefined): boolean {
  return code !== undefined && permissionCodes.has(code);
}

export function transportStatusSuffix(error: unknown): string {
  const code = transportCodes(error)[0];
  return code === undefined ? '' : ` Status: ${code}.`;
}
