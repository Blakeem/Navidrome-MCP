/**
 * Navidrome MCP Server - Web UI Cover Art Proxy
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import { pipeline, Readable } from 'node:stream';
import type { Config } from '../../config.js';
import { IdSchema } from '../../schemas/index.js';
import { buildSubsonicAuthParams } from '../../utils/subsonic-auth.js';
import { fetchWithTimeout, getNavidromeRequestTimeoutMs } from '../../utils/fetch-with-timeout.js';
import { logger } from '../../utils/logger.js';
import { writeError } from '../http-helpers.js';

/**
 * Raster types only. An HTML error page or an SVG, which can embed script, cached for 24h on this
 * origin would be a stored-XSS vector.
 */
const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

const MIN_COVER_SIZE = 16;
const MAX_COVER_SIZE = 1024;

function parseCoverSize(rawSize: string): string | null {
  if (!/^\d{1,4}$/.test(rawSize)) return null;
  const size = Number.parseInt(rawSize, 10);
  return size >= MIN_COVER_SIZE && size <= MAX_COVER_SIZE ? String(size) : null;
}

/**
 * The proxy keeps the Subsonic credentials server-side. `getCoverArt.view` takes an album id or a
 * song id, so the id kind is not checked.
 */
export async function handleCover(
  res: ServerResponse,
  config: Config,
  rawId: string,
  rawSize: string | null,
): Promise<void> {
  const parsed = IdSchema.safeParse({ id: rawId });
  if (!parsed.success) {
    writeError(res, 400, 'Invalid id');
    return;
  }
  const id = parsed.data.id;

  const size = rawSize === null ? null : parseCoverSize(rawSize);
  if (rawSize !== null && size === null) {
    writeError(res, 400, 'Invalid size');
    return;
  }

  const params = buildSubsonicAuthParams(
    config.navidromeUsername,
    config.navidromePassword,
    size === null ? { id } : { id, size },
  );
  const url = `${config.navidromeUrl}/rest/getCoverArt.view?${params.toString()}`;

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(
      url,
      {},
      {
        timeoutMs: getNavidromeRequestTimeoutMs(),
        retryPolicy: 'safe',
        operationLabel: 'cover-art fetch',
      },
    );
  } catch (err) {
    // A 502 lets the UI render a placeholder without implying the web server itself is down.
    logger.debug(
      `webui: cover proxy fetch failed for id=${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
    writeError(res, 502, 'Upstream cover-art fetch failed');
    return;
  }

  if (!upstream.ok || upstream.body === null) {
    writeError(res, upstream.status === 404 ? 404 : 502, `Upstream returned ${upstream.status}`);
    upstream.body?.cancel().catch(() => undefined);
    return;
  }

  const rawType = upstream.headers.get('content-type') ?? '';
  const baseType = rawType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  // Navidrome answers an unknown id with 200 and a Subsonic XML error, which this check rejects.
  if (!ALLOWED_IMAGE_TYPES.has(baseType)) {
    logger.debug(`webui: cover proxy rejected non-image content-type "${rawType}" for id=${id}`);
    writeError(res, 502, 'Upstream returned a non-image cover');
    upstream.body.cancel().catch(() => undefined);
    return;
  }
  const contentType = baseType;
  // Album art rarely changes, so a long browser cache spares a phone a re-fetch on every snapshot.
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400',
  };
  const contentLength = upstream.headers.get('content-length');
  if (contentLength !== null) headers['Content-Length'] = contentLength;
  res.writeHead(200, headers);

  // A stream error must abort the response, because a cleanly ended chunked body would be cached as
  // a complete image.
  pipeline(Readable.fromWeb(upstream.body), res, (err) => {
    if (err) logger.debug(`webui: cover stream error for id=${id}: ${err.message}`);
  });
}
