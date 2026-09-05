/*
 * Copyright (c) 2026, Karl Livesey.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
  exponent: number;
}

interface NormalizedDecimal {
  digits: string;
  scale: number;
}

const DECIMAL_PATTERN = /^(?<sign>-?)(?<integer>0|[1-9]\d*)(?:\.(?<fraction>\d+))?(?:[eE](?<exponent>[+-]?\d+))?$/u;
const MAX_DECIMAL_TOKEN_LENGTH = 128;
const MAX_ABSOLUTE_EXPONENT = 400;
const MAX_FRACTIONAL_SIGNIFICANT_DIGITS = 15;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseDecimalParts(token: string): DecimalParts | null {
  if (token.length === 0 || token.length > MAX_DECIMAL_TOKEN_LENGTH) {
    return null;
  }
  const match = DECIMAL_PATTERN.exec(token);
  if (match?.groups === undefined) {
    return null;
  }
  const exponent = Number(match.groups.exponent ?? '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_ABSOLUTE_EXPONENT) {
    return null;
  }
  return {
    negative: match.groups.sign === '-',
    integer: match.groups.integer ?? '',
    fraction: match.groups.fraction ?? '',
    exponent,
  };
}

function normalizeDecimal(parts: DecimalParts): NormalizedDecimal {
  const withoutLeadingZeros = `${parts.integer}${parts.fraction}`.replace(/^0+/u, '');
  const trailingZeros = withoutLeadingZeros.length - withoutLeadingZeros.replace(/0+$/u, '').length;
  return {
    digits: withoutLeadingZeros.slice(0, withoutLeadingZeros.length - trailingZeros),
    scale: parts.fraction.length - parts.exponent - trailingZeros,
  };
}

function safeWholeNumber(token: string, parts: DecimalParts, decimal: NormalizedDecimal): number | null {
  if (decimal.scale > 0 || BigInt(`${decimal.digits}${'0'.repeat(-decimal.scale)}`) > MAX_SAFE_INTEGER_BIGINT) {
    return null;
  }
  const value = Number(token);
  return Number.isSafeInteger(value) && !(parts.negative && value === 0) ? value : null;
}

function safeFractionalNumber(token: string, decimal: NormalizedDecimal, integerOnly: boolean): number | null {
  if (integerOnly || decimal.digits.length > MAX_FRACTIONAL_SIGNIFICANT_DIGITS) {
    return null;
  }
  const value = Number(token);
  return Number.isFinite(value) && value !== 0 && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

export function parseSafeFlowNumberToken(token: string, integerOnly: boolean): number | null {
  const parts = parseDecimalParts(token);
  if (parts === null) {
    return null;
  }
  const decimal = normalizeDecimal(parts);
  if (decimal.digits.length === 0) {
    return parts.negative ? null : 0;
  }
  if (decimal.scale <= 0) {
    return safeWholeNumber(token, parts, decimal);
  }
  return safeFractionalNumber(token, decimal, integerOnly);
}

export function preprocessFlowNumber(value: unknown, integerOnly: boolean): unknown {
  if (typeof value === 'number') {
    return Object.is(value, -0) ? value : parseSafeFlowNumberToken(String(value), integerOnly) ?? undefined;
  }
  if (typeof value === 'string') {
    return parseSafeFlowNumberToken(value.trim(), integerOnly) ?? value;
  }
  return value;
}

function safeJsonNumberReviver(_key: string, value: unknown, ...contextValues: unknown[]): unknown {
  if (typeof value !== 'number') {
    return value;
  }
  const context = contextValues[0];
  const source =
    typeof context === 'object' && context !== null && 'source' in context
      ? (context as { source?: unknown }).source
      : undefined;
  if (typeof source !== 'string' || parseSafeFlowNumberToken(source, false) === null) {
    throw new RangeError('JSON numeric values must satisfy the Flow input precision policy.');
  }
  return value;
}

export function parseSafeFlowJson(text: string): unknown {
  return JSON.parse(text, safeJsonNumberReviver) as unknown;
}
