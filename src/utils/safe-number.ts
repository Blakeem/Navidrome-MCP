/**
 * Navidrome MCP Server - Safe numeric coercion
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * External APIs such as Last.fm send numbers as strings and sometimes as "unknown" or null. A NaN
 * serializes to null in JSON and breaks a later comparison such as `match >= 0.5`.
 */
export function safeNumber(value: unknown, fallback = 0): number {
  // Number(null) and Number('') return 0, which would hide a nonzero fallback.
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
