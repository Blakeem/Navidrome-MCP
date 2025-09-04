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

import { z } from 'zod';
import type { LyricsDTO, LyricsLine } from '../types/index.js';
import type { Config } from '../config.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

/**
 * Schema for getting lyrics
 */
export const GetLyricsArgsSchema = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  durationMs: z.number().min(0).optional(),
  id: z.string().optional()
});

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
  const lrcRegex = /\[(\d{2}):(\d{2})\.(\d{2})\](.+)/g;
  
  let match;
  while ((match = lrcRegex.exec(lrcText)) !== null) {
    const [, minutesStr, secondsStr, centisecondsStr, textStr] = match;
    if (!minutesStr || !secondsStr || !centisecondsStr || !textStr) continue;
    
    const minutes = parseInt(minutesStr, 10);
    const seconds = parseInt(secondsStr, 10);
    const centiseconds = parseInt(centisecondsStr, 10);
    const timeMs = (minutes * 60 + seconds) * 1000 + centiseconds * 10;
    const text = textStr.trim();
    
    if (text) {
      lines.push({ timeMs, text });
    }
  }
  
  return lines;
}

/**
 * Try to get lyrics using exact match
 */
async function tryExactMatch(params: z.infer<typeof GetLyricsArgsSchema>, config: Config): Promise<LRCLIBResponse | null> {
  try {
    const url = new URL('/api/get', config.lrclibBase);
    
    if (params.id) {
      url.searchParams.set('id', params.id);
    } else {
      url.searchParams.set('track_name', params.title);
      url.searchParams.set('artist_name', params.artist);
      if (params.album) url.searchParams.set('album_name', params.album);
      if (params.durationMs) url.searchParams.set('duration', String(Math.round(params.durationMs / 1000)));
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': config.lrclibUserAgent || 'Navidrome-MCP/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.httpRequest('LRCLIB API', response));
    }
    
    return await response.json() as LRCLIBResponse;
  } catch {
    // If exact match fails, return null to try search
    return null;
  }
}

/**
 * Search for lyrics and find best match
 */
async function searchLyrics(params: z.infer<typeof GetLyricsArgsSchema>, config: Config): Promise<LRCLIBResponse | null> {
  try {
    const url = new URL('/api/search', config.lrclibBase);
    url.searchParams.set('query', `${params.title} ${params.artist}`);
    if (params.durationMs) {
      url.searchParams.set('duration', String(Math.round(params.durationMs / 1000)));
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': config.lrclibUserAgent || 'Navidrome-MCP/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(ErrorFormatter.httpRequest('LRCLIB search API', response));
    }
    
    const results = await response.json() as LRCLIBResponse[];
    
    if (!results || results.length === 0) {
      return null;
    }
    
    // Find best match
    // 1. Prefer exact artist and title match
    // 2. If duration provided, prefer within 3% tolerance
    const titleLower = params.title.toLowerCase();
    const artistLower = params.artist.toLowerCase();
    const durationSec = params.durationMs ? params.durationMs / 1000 : null;
    
    let bestMatch: LRCLIBResponse | null = null;
    let bestScore = -1;
    
    for (const result of results) {
      let score = 0;
      
      // Check title match
      if (result.trackName?.toLowerCase() === titleLower) {
        score += 10;
      } else if (result.trackName?.toLowerCase().includes(titleLower)) {
        score += 5;
      }
      
      // Check artist match
      if (result.artistName?.toLowerCase() === artistLower) {
        score += 10;
      } else if (result.artistName?.toLowerCase().includes(artistLower)) {
        score += 5;
      }
      
      // Check duration match (within 3% tolerance)
      if (durationSec && result.duration) {
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
    
    return bestMatch;
  } catch {
    return null;
  }
}

/**
 * Get lyrics for a song
 */
export async function getLyrics(config: Config, args: unknown): Promise<LyricsDTO> {
  const params = GetLyricsArgsSchema.parse(args);
  
  try {
    // Try exact match first
    let lyricsData = await tryExactMatch(params, config);
    
    // If no exact match, try searching
    if (!lyricsData) {
      lyricsData = await searchLyrics(params, config);
    }
    
    // If still no match, return empty lyrics
    if (!lyricsData) {
      const result: LyricsDTO = {
        track: {
          title: params.title,
          artist: params.artist,
          ...(params.album ? { album: params.album } : {}),
          ...(params.durationMs ? { durationMs: params.durationMs } : {})
        },
        isInstrumental: false,
        provider: 'lrclib',
        attribution: {
          url: 'https://lrclib.net',
          license: 'community-sourced'
        }
      };
      return result;
    }
    
    // Parse synced lyrics if available
    let syncedLines: LyricsLine[] | undefined;
    if (lyricsData.syncedLyrics) {
      syncedLines = parseSyncedLyrics(lyricsData.syncedLyrics);
    }
    
    const result: LyricsDTO = {
      track: {
        title: lyricsData.trackName || params.title,
        artist: lyricsData.artistName || params.artist
      },
      isInstrumental: Boolean(lyricsData.instrumental),
      provider: 'lrclib',
      attribution: {
        url: 'https://lrclib.net',
        license: 'community-sourced'
      }
    };
    
    // Add optional fields only if they have values
    const album = lyricsData.albumName || params.album;
    if (album) {
      result.track.album = album;
    }
    
    const durationMs = lyricsData.duration ? lyricsData.duration * 1000 : params.durationMs;
    if (durationMs) {
      result.track.durationMs = durationMs;
    }
    
    if (syncedLines && syncedLines.length > 0) {
      result.synced = syncedLines;
    }
    
    if (lyricsData.plainLyrics) {
      result.unsynced = lyricsData.plainLyrics;
    }
    
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('getLyrics', error));
  }
}