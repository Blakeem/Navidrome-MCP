/**
 * Navidrome MCP Server - Web UI Static File Serving
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { writeError } from '../http-helpers.js';

// scripts/build-webui.mjs copies src/webui/public to dist/webui/public, so the folder is a sibling
// of routes/ in both trees.
function resolvePublicDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
}

export const PUBLIC_DIR: string = resolvePublicDir();
if (!existsSync(PUBLIC_DIR)) {
  logger.error(`webui: static asset folder ${PUBLIC_DIR} is missing, so every page answers 404. pnpm build copies it there.`);
}

/**
 * Every directive is named, so none silently inherits `default-src`. `data:` serves the inline SVG
 * favicon in `img-src` and the wake-lock fallback video in `media-src`.
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

// Covers the asset types the public folders ship.
const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/** Dot segments are rejected, so a dotfile left in a public folder by accident never leaks. */
function resolveStaticPath(pathname: string, publicDir: string): string | null {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = normalize(rel.replace(/^\/+/, ''));
  if (rel.includes(`..${sep}`) || rel === '..') return null;
  // A `/.` substring check would miss a root-level dotfile such as `/.env`, so every segment is
  // checked.
  if (rel.split(sep).some((s) => s.startsWith('.'))) return null;
  const abs = join(publicDir, rel);
  // Defense in depth behind the traversal checks above.
  if (!abs.startsWith(publicDir + sep) && abs !== publicDir) return null;
  return abs;
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/** `publicDir` is a parameter so the settings page reuses this handler and its CSP. */
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
      // A LAN client revalidates every load, so it never runs a stale app.js after an upgrade.
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
