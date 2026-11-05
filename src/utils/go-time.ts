/**
 * Navidrome MCP Server - Go zero-time helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Go's zero `time.Time`. Navidrome sends it for a field it never set, such as `updatedAt` on a
 * never-saved queue, and it is never a real timestamp.
 */
const GO_ZERO_TIME = '0001-01-01T00:00:00Z';

/** An empty string passes through, so each caller decides what "" means. */
export function nullIfGoZeroTime(ts: string | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  return ts === GO_ZERO_TIME ? null : ts;
}
