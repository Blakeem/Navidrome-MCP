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

/**
 * Resolve the absolute directory holding the web UI static assets.
 *
 * The public directory is always a sibling of this file's containing folder
 * regardless of whether we're running from `src/webui/` (dev via tsx) or
 * `dist/webui/` (production via tsc). The build pipeline (scripts/build-webui.mjs)
 * copies `src/webui/public/` to `dist/webui/public/` so the sibling lookup
 * succeeds in both contexts.
 */
function resolvePublicDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromRoutes = resolve(here, '..', 'public');
  if (existsSync(fromRoutes)) return fromRoutes;
  // Fallback: a sibling of THIS file (i.e. routes/public) — unlikely but
  // covers reorganization without re-running the build.
  return resolve(here, 'public');
}

const PUBLIC_DIR: string = resolvePublicDir();

/**
 * MIME-type table for the asset shapes we actually ship. Anything outside
 * the table falls back to `application/octet-stream` — but since the only
 * files in `public/` are .html/.css/.js/.svg/.ico, that branch should never
 * fire in practice.
 */
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
 * Resolve a request URL pathname to an absolute file path inside PUBLIC_DIR,
 * or null if the request escapes the directory (path traversal).
 *
 * `/` maps to `/index.html` so the panel loads on a bare visit. Hidden files
 * (anything with `/.`) are rejected to keep dotfiles from leaking even when
 * the public folder accidentally contains them.
 */
function resolveStaticPath(pathname: string): string | null {
  let rel = pathname === '/' ? '/index.html' : pathname;
  // Strip leading slash; normalize collapses any `..` segments.
  rel = normalize(rel.replace(/^\/+/, ''));
  if (rel.includes(`..${sep}`) || rel === '..') return null;
  // Reject any path SEGMENT that begins with a dot. Checking the post-strip
  // `rel` for `/.` would miss root-level dotfiles (e.g. `/.env` -> `.env`),
  // so split on the separator and reject leading dots in any segment.
  if (rel.split(sep).some((s) => s.startsWith('.'))) return null;
  const abs = join(PUBLIC_DIR, rel);
  // Defense-in-depth: confirm the resolved path is still inside PUBLIC_DIR.
  if (!abs.startsWith(PUBLIC_DIR + sep) && abs !== PUBLIC_DIR) return null;
  return abs;
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * GET <static-asset> — serves files out of PUBLIC_DIR. Returns 404 for
 * unknown paths so the API surface above is the canonical 4xx handler;
 * static serving is deliberately not the catch-all.
 */
export async function handleStatic(res: ServerResponse, pathname: string): Promise<void> {
  const filePath = resolveStaticPath(pathname);
  if (filePath === null) {
    writeError(res, 400, 'Invalid path');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Content-Length': body.byteLength.toString(),
      // No persistent caching for any webui asset. The panel is served to
      // LAN clients, all files are KB-scale, and aggressive caching on
      // app.js/styles.css had been silently locking users on stale JS
      // (volume-icon state machine missing from cached bundle even after
      // a hard refresh). Browsers will still revalidate cheaply via
      // If-Modified-Since.
      'Cache-Control': 'no-cache, must-revalidate',
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
