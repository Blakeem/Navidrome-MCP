/**
 * Navidrome MCP Server - Web UI Lyrics Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { NavidromeClient } from '../../client/navidrome-client.js';
import type { Config } from '../../config.js';
import { IdSchema } from '../../schemas/index.js';
import { buildLyricsLookup, resolveLyricsByMetadata } from '../../tools/lyrics.js';
import { getPlayQueue } from '../../tools/playback.js';
import type { LyricsDTO } from '../../types/index.js';
import { Cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { writeError, writeJson } from '../http-helpers.js';

type QueueItem = Awaited<ReturnType<typeof getPlayQueue>>['items'][number];

/** A track's lyrics do not change, so an answered lookup is held for an hour. */
const HIT_TTL_SECONDS = 3600;

/**
 * A miss expires sooner, since queue metadata arrives by best-effort enrichment and an entry with
 * no artist yet can become searchable moments later.
 */
const MISS_TTL_SECONDS = 60;

// `Cache` fixes one TTL per instance, so hits and misses need separate stores.
const hitCache = new Cache<LyricsDTO>(HIT_TTL_SECONDS);
const missCache = new Cache<LyricsDTO>(MISS_TTL_SECONDS);

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A DTO with no text and no instrumental flag is a miss to retry, not an answer to hold. */
function isAnswered(dto: LyricsDTO): boolean {
  return dto.hasSynced || dto.unsynced !== undefined || dto.isInstrumental;
}

/**
 * Track metadata comes from the live queue, so the browser cannot steer an LRCLIB query. A song
 * with no lyrics answers 200 with an empty DTO, so the overlay can tell no lyrics from a failure.
 */
export async function handleLyrics(
  res: ServerResponse,
  config: Config,
  client: NavidromeClient,
  rawId: string,
): Promise<void> {
  const parsed = IdSchema.safeParse({ id: rawId });
  if (!parsed.success) {
    writeError(res, 400, 'Invalid id');
    return;
  }
  const songId = parsed.data.id;

  const cached = hitCache.get(songId) ?? missCache.get(songId);
  if (cached !== undefined) {
    writeJson(res, 200, cached);
    return;
  }

  let entry: QueueItem | undefined;
  try {
    const queue = await getPlayQueue(client, {});
    entry = queue.items.find((item) => item.songId === songId);
  } catch (err) {
    logger.debug(`webui: lyrics queue lookup failed for id=${songId}: ${errorText(err)}`);
    writeError(res, 502, 'Play-queue lookup failed');
    return;
  }
  if (entry === undefined) {
    writeError(res, 404, 'Song is not in the current play queue');
    return;
  }

  const lookup = buildLyricsLookup({
    title: entry.title,
    artist: entry.artist,
    album: entry.album,
    duration: entry.duration,
  });
  // Local file lyrics need neither a title nor an artist, so only the LRCLIB query is gated.
  const allowLrclib = config.features.lyrics && lookup.searchable;

  let dto: LyricsDTO;
  try {
    dto = await resolveLyricsByMetadata(config, lookup.metadata, { local: { client, songId }, allowLrclib });
  } catch (err) {
    logger.debug(`webui: lyrics lookup failed for id=${songId}: ${errorText(err)}`);
    writeError(res, 502, 'Lyrics lookup failed');
    return;
  }

  const store = isAnswered(dto) ? hitCache : missCache;
  store.set(songId, dto);
  writeJson(res, 200, dto);
}
