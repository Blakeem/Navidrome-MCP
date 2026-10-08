/**
 * Navidrome MCP Server - Web UI Static File Serving
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

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { writeError } from '../http-helpers.js';

// scripts/build-webui.mjs copies src/webui/public to dist/webui/public, so the folder is a sibling of routes/ in both trees.
function resolvePublicDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
}

export const PUBLIC_DIR: string = resolvePublicDir();
if (!existsSync(PUBLIC_DIR)) {
  logger.error(`webui: static asset folder ${PUBLIC_DIR} is missing, so every page answers 404. pnpm build copies it there.`);
}

/**
 * Every directive is named so none of them silently inherits `default-src`.
 * `data:` is in `img-src` for the inline SVG favicon and in `media-src` for the
 * muted wake-lock fallback video, which the plain-http LAN origin depends on
 * because `navigator.wakeLock` exists only in a secure context.
 */
const CONTENT_SECURITY_POLICY: string = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  'media-src data:',
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

// Covers the asset types the public folders ship. Anything else is served as application/octet-stream.
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Resolve a request URL pathname to an absolute file path inside `publicDir`,
 * or null if the request escapes the directory (path traversal).
 *
 * `/` maps to `/index.html` so the panel loads on a bare visit. Any path segment
 * that starts with a dot is rejected, so dotfiles and dot-folders never leak even
 * when the public folder accidentally contains them.
 */
function resolveStaticPath(pathname: string, publicDir: string): string | null {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // normalize collapses any `..` segments once the leading slashes are gone.
  rel = normalize(rel.replace(/^\/+/, ''));
  if (rel.includes(`..${sep}`) || rel === '..') return null;
  // A `/.` substring check would miss a root-level dotfile such as `/.env`, so every segment is checked.
  if (rel.split(sep).some((s) => s.startsWith('.'))) return null;
  const abs = join(publicDir, rel);
  // Defense-in-depth: confirm the resolved path is still inside publicDir.
  if (!abs.startsWith(publicDir + sep) && abs !== publicDir) return null;
  return abs;
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * GET <static-asset> serves files out of `publicDir`, the web remote's by default, so
 * the settings page shares this CSP. Returns 404 for unknown paths, since static
 * serving is deliberately not the catch-all.
 */
export async function handleStatic(
  res: ServerResponse,
  pathname: string,
  publicDir: string = PUBLIC_DIR,
): Promise<void> {
  const filePath = resolveStaticPath(pathname, publicDir);
  if (filePath === null) {
    writeError(res, 400, 'Invalid path');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Content-Length': body.byteLength.toString(),
      // no-cache so a LAN client never runs a stale app.js after an upgrade.
      'Cache-Control': 'no-cache, must-revalidate',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    });
    res.end(body);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      writeError(res, 404, 'Not found');
      return;
    }
    logger.debug(`webui: static read failed for ${pathname}: ${err instanceof Error ? err.message : String(err)}`);
    writeError(res, 500, 'Static file error');
  }
}
