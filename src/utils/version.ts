/**
 * Navidrome MCP Server - Package version
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FALLBACK_VERSION = '0.0.0';

export function getPackageVersion(): string {
  try {
    const packageJsonPath = join(__dirname, '../../package.json');
    const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const v = (parsed as { version?: unknown }).version;
    if (typeof v === 'string' && v.length > 0) return v;
    return FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}