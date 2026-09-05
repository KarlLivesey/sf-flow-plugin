/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
interface TemporalApi {
  Instant: {
    from: (value: string) => { epochMilliseconds: number };
  };
  PlainDate: {
    from: (value: string) => {
      toZonedDateTime: (timeZone: string) => {
        toInstant: () => { epochMilliseconds: number };
      };
    };
  };
}

const nativeTemporal = (globalThis as typeof globalThis & { Temporal?: TemporalApi }).Temporal;
const temporal: TemporalApi = nativeTemporal ?? (await import('@js-temporal/polyfill')).Temporal;

export function parseSalesforceDateTime(value: string): number {
  return temporal.Instant.from(value).epochMilliseconds;
}

export function parseFlowVersionDateFilter(value: string): number {
  return value.length === 10
    ? temporal.PlainDate.from(value).toZonedDateTime('UTC').toInstant().epochMilliseconds
    : parseSalesforceDateTime(value);
}

function canParse(parser: (value: string) => number, value: string): boolean {
  try {
    parser(value);
    return true;
  } catch {
    return false;
  }
}

export function isSalesforceDateTime(value: string): boolean {
  return canParse(parseSalesforceDateTime, value);
}

export function isFlowVersionDateFilter(value: string): boolean {
  return canParse(parseFlowVersionDateFilter, value);
}
