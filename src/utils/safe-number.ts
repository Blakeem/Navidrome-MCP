/**
 * Navidrome MCP Server - Safe numeric coercion
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * Coerce an unknown value (typically from a JSON API response) to a finite
 * number, returning `fallback` for null, undefined, NaN, ±Infinity, and any
 * non-numeric string.
 *
 * This exists because external APIs (Last.fm, Radio Browser, etc.) return
 * numbers as strings (e.g. `"match": "0.823"`) and occasionally return the
 * literal string `"unknown"` or `null` for sparse fields. `parseFloat("unknown")`
 * yields `NaN`, which `JSON.stringify` writes as `null`, silently corrupting
 * any downstream code that does `match >= 0.5`.
 *
 * Use this for every numeric coercion of external-API data.
 *
 * @param value Anything; most commonly `string | number | null | undefined`.
 * @param fallback Returned when `value` cannot be coerced to a finite number.
 *                 Defaults to `0`.
 */
export function safeNumber(value: unknown, fallback = 0): number {
  // Number(null), Number(undefined) (NaN), and Number('') all coerce to a
  // finite 0 or NaN that the JSDoc says should be the fallback. Guard these
  // explicitly so a non-zero sentinel fallback isn't silently turned into 0.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
