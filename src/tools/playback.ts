/**
 * Navidrome MCP Server - Playback Tool Functions
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
import type { NavidromeClient } from '../client/navidrome-client.js';
import { playbackEngine, type PlaybackStatus } from '../services/playback/playback-engine.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { logger } from '../utils/logger.js';

interface PauseResult {
  success: true;
  paused: true;
}

interface ResumeResult {
  success: true;
  paused: false;
}

interface SetVolumeResult {
  success: true;
  volume: number;
}

interface PlaySongResult {
  success: true;
  songId: string;
  title?: string;
  artist?: string;
  album?: string;
}

interface PlayAlbumResult {
  success: true;
  albumId: string;
  trackCount: number;
  shuffled: boolean;
}

interface NextResult {
  success: true;
}

interface PreviousResult {
  success: true;
}

interface SeekResult {
  success: true;
  seconds: number;
  mode: 'absolute' | 'relative';
}

interface NowPlayingResult {
  engineRunning: boolean;
  title?: string;
  artist?: string;
  album?: string;
  position?: number;
  duration?: number;
  paused?: boolean;
  queueIndex?: number;
  queueLength?: number;
}

const SetVolumeSchema = z.object({
  level: z.number().min(0).max(100),
});

const PlaySongSchema = z.object({
  songId: z.string().min(1, 'songId is required'),
});

const PlayAlbumSchema = z.object({
  albumId: z.string().min(1, 'albumId is required'),
  shuffle: z.boolean().default(false),
});

const SeekSchema = z.object({
  seconds: z.number(),
  mode: z.enum(['absolute', 'relative']).default('relative'),
});

/**
 * Pause local audio playback. Lazy-spawns mpv on first call.
 */
export async function pause(_args: unknown): Promise<PauseResult> {
  try {
    logger.debug('playback: pause');
    await playbackEngine.pause();
    return { success: true, paused: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('pause', error));
  }
}

/**
 * Resume local audio playback. Lazy-spawns mpv on first call.
 */
export async function resume(_args: unknown): Promise<ResumeResult> {
  try {
    logger.debug('playback: resume');
    await playbackEngine.resume();
    return { success: true, paused: false };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('resume', error));
  }
}

/**
 * Set mpv's internal volume. `level` is clamped to [0, 100].
 * Lazy-spawns mpv on first call.
 */
export async function setVolume(args: unknown): Promise<SetVolumeResult> {
  let parsed: z.infer<typeof SetVolumeSchema>;
  try {
    parsed = SetVolumeSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('set_volume', error));
  }

  try {
    logger.debug(`playback: set_volume level=${parsed.level}`);
    const applied = await playbackEngine.setVolume(parsed.level);
    return { success: true, volume: applied };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('set_volume', error));
  }
}

/**
 * Report engine health. Does NOT spawn mpv, but will silently attach to an
 * already-running mpv (e.g. one spawned by a previous MCP server that has
 * since exited) so the report reflects reality after a restart.
 */
export async function playbackStatus(_args: unknown): Promise<PlaybackStatus> {
  try {
    await playbackEngine.ensureAttached();
    return playbackEngine.getStatus();
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('playback_status', error));
  }
}

/**
 * Play a single song through the local speakers. Verifies the song exists
 * via the Navidrome API, builds a stream URL, and replaces the mpv playlist.
 */
export async function playSong(client: NavidromeClient, args: unknown): Promise<PlaySongResult> {
  let parsed: z.infer<typeof PlaySongSchema>;
  try {
    parsed = PlaySongSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_song', error));
  }

  try {
    logger.debug(`playback: play_song id=${parsed.songId}`);

    // Verify song exists and grab metadata for nicer feedback. Mirrors the
    // `getSong` pattern in src/tools/media-library.ts.
    const rawSong = await client.request<unknown>(`/song/${parsed.songId}`);
    const song = (typeof rawSong === 'object' && rawSong !== null)
      ? (rawSong as Record<string, unknown>)
      : {};

    await playbackEngine.playSong(parsed.songId);

    const result: PlaySongResult = {
      success: true,
      songId: parsed.songId,
    };
    if (typeof song['title'] === 'string') result.title = song['title'];
    if (typeof song['artist'] === 'string') result.artist = song['artist'];
    if (typeof song['album'] === 'string') result.album = song['album'];
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_song', error));
  }
}

/**
 * Resolve an album to its ordered track list, optionally shuffle, and
 * replace the mpv playlist with the resulting stream URLs.
 */
export async function playAlbum(client: NavidromeClient, args: unknown): Promise<PlayAlbumResult> {
  let parsed: z.infer<typeof PlayAlbumSchema>;
  try {
    parsed = PlayAlbumSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_album', error));
  }

  try {
    logger.debug(`playback: play_album albumId=${parsed.albumId} shuffle=${parsed.shuffle}`);

    // Fetch tracks for the album. Navidrome's REST API uses `album_id`
    // (snake_case) for filter params; the default sort is unstable, so we
    // explicitly sort by `album` which produces natural disc/track order
    // (handling multi-disc releases correctly).
    const params = new URLSearchParams({
      album_id: parsed.albumId,
      _start: '0',
      _end: '500',
      _sort: 'album',
      _order: 'ASC',
    });
    const endpoint = `/song?${params.toString()}`;
    const rawTracks = await client.request<unknown>(endpoint);

    if (!Array.isArray(rawTracks)) {
      throw new Error(`Unexpected response shape from ${endpoint}: expected array`);
    }
    const ids: string[] = [];
    for (const track of rawTracks) {
      if (typeof track === 'object' && track !== null) {
        const id = (track as Record<string, unknown>)['id'];
        if (typeof id === 'string' && id !== '') {
          ids.push(id);
        }
      }
    }

    if (ids.length === 0) {
      throw new Error(`No tracks found for album ${parsed.albumId}`);
    }

    const ordered = parsed.shuffle ? fisherYatesShuffle(ids) : ids;

    if (parsed.shuffle) {
      logger.debug(`playback: shuffled album track order: ${ordered.join(',')}`);
    }

    await playbackEngine.playAlbum(ordered);

    return {
      success: true,
      albumId: parsed.albumId,
      trackCount: ordered.length,
      shuffled: parsed.shuffle,
    };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('play_album', error));
  }
}

/**
 * Skip to the next track in mpv's playlist.
 */
export async function next(_args: unknown): Promise<NextResult> {
  try {
    logger.debug('playback: next');
    await playbackEngine.next();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('next', error));
  }
}

/**
 * Skip to the previous track in mpv's playlist.
 */
export async function previous(_args: unknown): Promise<PreviousResult> {
  try {
    logger.debug('playback: previous');
    await playbackEngine.previous();
    return { success: true };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('previous', error));
  }
}

/**
 * Seek within the currently playing track.
 */
export async function seek(args: unknown): Promise<SeekResult> {
  let parsed: z.infer<typeof SeekSchema>;
  try {
    parsed = SeekSchema.parse(args);
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }

  try {
    logger.debug(`playback: seek seconds=${parsed.seconds} mode=${parsed.mode}`);
    await playbackEngine.seek(parsed.seconds, parsed.mode);
    return { success: true, seconds: parsed.seconds, mode: parsed.mode };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('seek', error));
  }
}

/**
 * Read current playback state from the engine's observed-property cache.
 * Does NOT trigger a lazy spawn — read tools never start mpv. Will
 * transparently attach to an already-running mpv (e.g. one that survived
 * an MCP restart) so the report reflects the actual playback state.
 */
export async function nowPlaying(_args: unknown): Promise<NowPlayingResult> {
  try {
    await playbackEngine.ensureAttached();
    const status = playbackEngine.getStatus();
    if (!status.engineRunning) {
      return { engineRunning: false };
    }

    const result: NowPlayingResult = { engineRunning: true };

    const queueIndex = playbackEngine.getCachedProperty('playlist-pos');
    if (typeof queueIndex === 'number') result.queueIndex = queueIndex;

    const queueLength = playbackEngine.getCachedProperty('playlist-count');
    if (typeof queueLength === 'number') result.queueLength = queueLength;

    const paused = playbackEngine.getCachedProperty('pause');
    if (typeof paused === 'boolean') result.paused = paused;

    const position = playbackEngine.getCachedProperty('time-pos');
    if (typeof position === 'number') result.position = position;

    const duration = playbackEngine.getCachedProperty('duration');
    if (typeof duration === 'number') result.duration = duration;

    const title = playbackEngine.getCachedProperty('media-title');
    if (typeof title === 'string') result.title = title;

    const metadata = playbackEngine.getCachedProperty('metadata');
    if (typeof metadata === 'object' && metadata !== null) {
      const meta = metadata as Record<string, unknown>;
      const artist = pickFirstString(meta, ['artist', 'Artist', 'ARTIST']);
      const album = pickFirstString(meta, ['album', 'Album', 'ALBUM']);
      if (artist !== null) result.artist = artist;
      if (album !== null) result.album = album;
    }

    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('now_playing', error));
  }
}

// ---------- helpers ----------

/**
 * Return a new array shuffled with Fisher-Yates. Pure; does not mutate input.
 */
function fisherYatesShuffle<T>(input: readonly T[]): T[] {
  const out = input.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * Read the first key from `obj` whose value is a non-empty string.
 * Used to tolerate metadata key-casing variation (mpv passes through
 * whatever ID3 frame names the source file used).
 */
function pickFirstString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}
