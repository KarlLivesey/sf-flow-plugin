/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { z } from 'zod';

import type { FlowDebugLogLevel } from '../types/flow-debug.js';

export const organisationResultSchema = z.object({
  records: z.array(z.object({ IsSandbox: z.boolean() })).min(1),
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
  if (transportCodes(error).some((code) => code === '401' || code === '403' || permissionCodes.has(code))) {
    return true;
  }
  return error instanceof Error && [...permissionCodes].some((code) => error.message.includes(code));
}

export function isPermissionCode(code: string | undefined): boolean {
  return code !== undefined && permissionCodes.has(code);
}

export function transportStatusSuffix(error: unknown): string {
  const code = transportCodes(error)[0];
  return code === undefined ? '' : ` Status: ${code}.`;
}
