/**
 * Navidrome MCP Server - Package version
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
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