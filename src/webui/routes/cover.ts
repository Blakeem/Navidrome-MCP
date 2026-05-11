/**
 * Navidrome MCP Server - Web UI Cover Art Proxy
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

import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Config } from '../../config.js';
import { IdSchema } from '../../schemas/common.js';
import { buildSubsonicAuthParams } from '../../utils/subsonic-auth.js';
import { logger } from '../../utils/logger.js';
import { writeError } from '../http-helpers.js';

/**
 * GET /api/cover/:id — Proxy the Subsonic `getCoverArt.view` endpoint.
 *
 * Credentials stay server-side (built per-request with a fresh salt; the
 * browser never sees a Subsonic auth token). The response body is streamed
 * through unmodified, preserving Navidrome's choice of image encoding so
 * the browser can pick the best decoder.
 *
 * `id` is validated against the Navidrome ID character set (`[A-Za-z0-9_-]+`)
 * before we even reach for the network — that pattern is also what `IdSchema`
 * enforces elsewhere in the codebase, so a request with `..` or path
 * separators is rejected as 400 with no upstream call. The Subsonic endpoint
 * accepts both album and song IDs (it returns the album-level art for either),
 * so we accept either kind without disambiguating.
 */
export async function handleCover(
  res: ServerResponse,
  config: Config,
  rawId: string,
): Promise<void> {
  const parsed = IdSchema.safeParse({ id: rawId });
  if (!parsed.success) {
    writeError(res, 400, 'Invalid id');
    return;
  }
  const id = parsed.data.id;

  const params = buildSubsonicAuthParams(
    config.navidromeUsername,
    config.navidromePassword,
    { id },
  );
  const base = config.navidromeUrl.replace(/\/+$/, '');
  const url = `${base}/rest/getCoverArt.view?${params.toString()}`;

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (err) {
    // Network failure reaching Navidrome — surface a discreet 502 so the
    // UI can render a placeholder without making the user think the server
    // itself is dead.
    logger.debug(
      `webui: cover proxy fetch failed for id=${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    writeError(res, 502, 'Upstream cover-art fetch failed');
    return;
  }

  if (!upstream.ok || upstream.body === null) {
    // Navidrome returns 404 for unknown IDs; pass it through.
    res.writeHead(upstream.status === 404 ? 404 : 502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ error: `Upstream returned ${upstream.status}` }));
    return;
  }

  // Pass through the content type Navidrome chose (image/jpeg, image/png, …)
  // and instruct the browser to cache aggressively — album art rarely changes
  // and re-fetching it on every UI snapshot would be wasteful, especially on
  // a phone.
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null) headers['Content-Length'] = contentLength;
  res.writeHead(200, headers);

  // Stream the body through. Convert the WHATWG ReadableStream to a Node
  // Readable; piping streams is preferable to buffering because some album
  // art (animated, high-res) can be several MB.
  const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
  nodeStream.on('error', (err) => {
    logger.debug(`webui: cover stream error for id=${id}: ${err.message}`);
    if (!res.writableEnded) res.end();
  });
  nodeStream.pipe(res);
}
