/**
 * Navidrome MCP Server - Blank-string rule for settings values
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** The runtime reads a null, absent or blank settings value alike, as unset. */
export function nonEmpty(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
