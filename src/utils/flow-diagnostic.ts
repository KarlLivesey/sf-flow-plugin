/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

const MAX_DIAGNOSTIC_LENGTH = 500;

export function safeFlowDiagnostic(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalised = value
    .replaceAll(/[\r\n\t]+/gu, ' ')
    .replaceAll(/\s{2,}/gu, ' ')
    .trim();
  if (normalised.length === 0) {
    return null;
  }
  return normalised.length <= MAX_DIAGNOSTIC_LENGTH ? normalised : `${normalised.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
}
