/**
 * Version utility to read version from package.json
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
    // Fallback version if package.json can't be read
    return FALLBACK_VERSION;
  }
}