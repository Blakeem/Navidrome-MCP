/**
 * Navidrome MCP Server - Lyrics Tools
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

import type { z } from 'zod';
import type { LyricsDTO, LyricsLine } from '../types/index.js';
import type { Config } from '../config.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';
import {
  fetchWithTimeout,
  getExternalApiTimeoutMs,
} from '../utils/fetch-with-timeout.js';
import { DEFAULT_USER_AGENT } from '../constants/defaults.js';
import { GetLyricsSchema } from '../schemas/index.js';

/**
 * LRCLIB API response interface
 */
interface LRCLIBResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

/**
 * Parse LRC format synced lyrics into structured format
 */
function parseSyncedLyrics(lrcText: string): LyricsLine[] {
  const lines: LyricsLine[] = [];
  const lrcRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.+)/g;

  let match;
  while ((match = lrcRegex.exec(lrcText)) !== null) {
    const [, minutesStr = '', secondsStr = '', fractionStr = '', textStr = ''] = match;

    const minutes = parseInt(minutesStr, 10);
    const seconds = parseInt(secondsStr, 10);
    const fraction = parseInt(fractionStr, 10);
    // 3-digit groups are milliseconds; 2-digit groups are centiseconds (×10).
    const fractionMs = fractionStr.length === 3 ? fraction : fraction * 10;
    const timeMs = (minutes * 60 + seconds) * 1000 + fractionMs;
    const text = textStr.trim();
    
    if (text) {
      lines.push({ timeMs, text });
    }
  }
  
  return lines;
}

/**
 * Try to get lyrics using exact match.
 * Returns null only for a genuine 404 (song not in LRCLIB).
 * All other errors (5xx, 429, network failures) are re-thrown so the caller
 * can distinguish "service unavailable / misconfigured" from "not found".
 */
async function tryExactMatch(params: z.infer<typeof GetLyricsSchema>, config: Config): Promise<LRCLIBResponse | null> {
  const url = new URL('/api/get', config.lrclibBase);

  if (params.id !== undefined && params.id !== '') {
    url.searchParams.set('id', params.id);
  } else {
    url.searchParams.set('track_name', params.title);
    url.searchParams.set('artist_name', params.artist);
    if (params.album !== undefined && params.album !== '') url.searchParams.set('album_name', params.album);
    if (params.durationMs !== undefined) url.searchParams.set('duration', String(Math.round(params.durationMs / 1000)));
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        'User-Agent': config.lrclibUserAgent ?? DEFAULT_USER_AGENT,
        'Accept': 'application/json'
      }
    },
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: 'LRCLIB /api/get',
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    // Re-throw transport errors (5xx, 429, etc.) — do NOT swallow as "not found".
    // A misconfigured User-Agent or a downed LRCLIB instance must surface to the caller.
    throw new Error(ErrorFormatter.httpRequest('LRCLIB API', response));
  }

  return await response.json() as LRCLIBResponse;
}

/**
 * Search for lyrics and find best match.
 * Re-throws transport errors (5xx, 429, network failures) so the caller can
 * distinguish "service unavailable" from "no matching lyrics in LRCLIB".
 */
async function searchLyrics(params: z.infer<typeof GetLyricsSchema>, config: Config): Promise<LRCLIBResponse | null> {
  const url = new URL('/api/search', config.lrclibBase);
  url.searchParams.set('query', `${params.title} ${params.artist}`);
  if (params.durationMs !== undefined) {
    url.searchParams.set('duration', String(Math.round(params.durationMs / 1000)));
  }

  const response = await fetchWithTimeout(
    url.toString(),
    {
      headers: {
        'User-Agent': config.lrclibUserAgent ?? DEFAULT_USER_AGENT,
        'Accept': 'application/json'
      }
    },
    {
      timeoutMs: getExternalApiTimeoutMs(),
      retryPolicy: 'safe',
      operationLabel: 'LRCLIB /api/search',
    },
  );

  if (!response.ok) {
    // Re-throw transport errors — do NOT swallow as "not found".
    throw new Error(ErrorFormatter.httpRequest('LRCLIB search API', response));
  }

  const results = await response.json() as LRCLIBResponse[];

  if (results.length === 0) {
    return null;
  }

  // Find best match
  // 1. Prefer exact artist and title match
  // 2. If duration provided, prefer within 3% tolerance
  const titleLower = params.title.toLowerCase();
  const artistLower = params.artist.toLowerCase();
  const durationSec = params.durationMs !== undefined ? params.durationMs / 1000 : undefined;

  let bestMatch: LRCLIBResponse | null = null;
  let bestScore = -1;

  for (const result of results) {
    let score = 0;

    // Check title match
    if (result.trackName?.toLowerCase() === titleLower) {
      score += 10;
    } else if (result.trackName?.toLowerCase().includes(titleLower) === true) {
      score += 5;
    }

    // Check artist match
    if (result.artistName?.toLowerCase() === artistLower) {
      score += 10;
    } else if (result.artistName?.toLowerCase().includes(artistLower) === true) {
      score += 5;
    }

    // Check duration match (within 3% tolerance)
    if (durationSec !== undefined && result.duration !== undefined) {
      const tolerance = durationSec * 0.03;
      const diff = Math.abs(result.duration - durationSec);
      if (diff <= tolerance) {
        score += 5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

/**
 * Get lyrics for a song
 */
export async function getLyrics(config: Config, args: unknown): Promise<LyricsDTO> {
  const params = GetLyricsSchema.parse(args);

  logger.debug('Tool getLyrics called with args:', params);

  // Attribution should point at the data source actually queried (which may be
  // a self-hosted LRCLIB mirror), not the public host. Derive it from the
  // configured base; fall back to the canonical host if the base is somehow
  // unparseable.
  let attributionUrl = 'https://lrclib.net';
  try {
    attributionUrl = new URL(config.lrclibBase).origin;
  } catch {
    // Keep the canonical default.
  }

  try {
    // Try exact match first
    let lyricsData = await tryExactMatch(params, config);
    
    // If no exact match, try searching
    lyricsData ??= await searchLyrics(params, config);
    
    // If still no match, return empty lyrics
    if (lyricsData === null) {
      const result: LyricsDTO = {
        track: {
          title: params.title,
          artist: params.artist,
          ...(params.album !== undefined && params.album !== '' ? { album: params.album } : {}),
          ...(params.durationMs !== undefined ? { durationMs: params.durationMs } : {})
        },
        isInstrumental: false,
        provider: 'lrclib',
        attribution: {
          url: attributionUrl,
          license: 'community-sourced'
        }
      };
      return result;
    }
    
    // Parse synced lyrics if available
    let syncedLines: LyricsLine[] | undefined;
    if (lyricsData.syncedLyrics !== undefined && lyricsData.syncedLyrics !== '') {
      syncedLines = parseSyncedLyrics(lyricsData.syncedLyrics);
    }
    
    const result: LyricsDTO = {
      track: {
        title: lyricsData.trackName ?? params.title,
        artist: lyricsData.artistName ?? params.artist
      },
      isInstrumental: Boolean(lyricsData.instrumental),
      provider: 'lrclib',
      attribution: {
        url: attributionUrl,
        license: 'community-sourced'
      }
    };
    
    // Add optional fields only if they have values
    const album = lyricsData.albumName ?? params.album;
    if (album !== undefined && album !== '') {
      result.track.album = album;
    }

    const durationMs = lyricsData.duration !== undefined ? lyricsData.duration * 1000 : params.durationMs;
    if (durationMs !== undefined) {
      result.track.durationMs = durationMs;
    }

    if (syncedLines !== undefined && syncedLines.length > 0) {
      result.synced = syncedLines;
    }

    if (lyricsData.plainLyrics !== undefined && lyricsData.plainLyrics !== '') {
      result.unsynced = lyricsData.plainLyrics;
    }
    
    return result;
  } catch (error) {
    // Transport errors (5xx, 429, network failures) are re-thrown with context so
    // callers can distinguish config/network problems from "song not in LRCLIB".
    logger.warn('getLyrics: LRCLIB request failed (transport/config error, not a missing track):', error instanceof Error ? error.message : String(error));
    throw new Error(ErrorFormatter.toolExecution('getLyrics', error));
  }
}