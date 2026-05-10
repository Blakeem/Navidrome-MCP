/**
 * Navidrome MCP Server - Playback Integration Test Helpers
 * Copyright (C) 2025
 *
 * Shared utilities for live playback integration tests.
 *
 * Architecture:
 *   - Live Navidrome reads via the shared singleton client (auth-token reuse)
 *   - Live mpv writes via the real `playbackEngine` singleton
 *   - Tests are skipped cleanly when Navidrome isn't reachable OR mpv isn't
 *     installed; never hard-fail in those environments
 *
 * IMPORTANT: helpers in this file MUST NOT modify Navidrome data. All Navidrome
 * calls go through search/get endpoints (read-only). All write side effects
 * are confined to the local mpv process.
 */

import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { loadConfig } from '../../../src/config.js';
import { detectMpvBinary } from '../../../src/services/playback/mpv-process.js';
import {
  playbackEngine,
  type PlaybackStatus,
} from '../../../src/services/playback/playback-engine.js';
import {
  clearPlayQueue as clearPlayQueueTool,
  getPlayQueue as getPlayQueueTool,
  moveInPlayQueue as moveInPlayQueueTool,
  next as nextTool,
  nowPlaying as nowPlayingTool,
  pause as pauseTool,
  playAlbums as playAlbumsTool,
  playAlbumsSearch as playAlbumsSearchTool,
  playSongs as playSongsTool,
  playSongsSearch as playSongsSearchTool,
  playbackStatus as playbackStatusTool,
  previous as previousTool,
  removeFromPlayQueue as removeFromPlayQueueTool,
  resume as resumeTool,
  seek as seekTool,
  setVolume as setVolumeTool,
  shufflePlayQueue as shufflePlayQueueTool,
} from '../../../src/tools/playback.js';
import {
  listRadioStations as listRadioStationsTool,
  playRadioStation as playRadioStationTool,
} from '../../../src/tools/radio.js';
import { searchAlbums, searchSongs } from '../../../src/tools/search/index.js';
import { shouldSkipLiveTests } from '../../helpers/env-detection.js';
import { getSharedLiveClient } from '../../factories/shared-client.js';

/* ------------------------------------------------------------------------- */
/* Skip logic                                                                */
/* ------------------------------------------------------------------------- */

/**
 * mpv binary detection is cached for the test run. Tests that rely on mpv
 * skip when this is null.
 */
const mpvAvailable: boolean = detectMpvBinary() !== null;

/**
 * Combined skip predicate: live tests skipped when Navidrome is unavailable
 * (per shared env-detection) OR when mpv isn't installed.
 */
function shouldSkipPlaybackTests(): boolean {
  return shouldSkipLiveTests() || !mpvAvailable;
}

/**
 * Reason string for the skip wrapper, matching env-detection's style.
 */
function getPlaybackSkipReason(): string {
  if (!mpvAvailable) {
    return 'mpv binary not found on PATH (set MPV_PATH or install mpv)';
  }
  return 'live tests disabled (no Navidrome config or CI without server)';
}

/**
 * Conditional describe wrapper for playback integration suites. Skips the
 * entire block when live tests are disabled OR mpv isn't installed.
 */
export function describePlayback(name: string, fn: () => void): void {
  if (shouldSkipPlaybackTests()) {
    describe.skip(`${name} (skipped: ${getPlaybackSkipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}

/**
 * Conditional `it` wrapper, mirroring describePlayback. Use this in place
 * of bare `it` for any test that touches mpv.
 */
export function itPlayback(name: string, fn: () => void | Promise<void>): void {
  if (shouldSkipPlaybackTests()) {
    it.skip(`${name} (skipped: ${getPlaybackSkipReason()})`, fn);
  } else {
    it(name, fn);
  }
}

/* ------------------------------------------------------------------------- */
/* Setup                                                                     */
/* ------------------------------------------------------------------------- */

interface TestContext {
  client: NavidromeClient;
  config: Config;
}

/**
 * Build a NavidromeClient + Config for the test suite, sharing both across
 * tests to avoid hammering Navidrome with auth requests. Configures the
 * playback engine singleton on first call.
 *
 * Returns null when live tests should be skipped — callers are expected to
 * use describePlayback/itPlayback so they never reach this in skip mode,
 * but we tolerate it defensively.
 */
export async function setupClientAndConfig(): Promise<TestContext> {
  const client = await getSharedLiveClient();
  const config = await loadConfig();
  // Engine is a module-scoped singleton; configure() is idempotent.
  playbackEngine.configure(config);
  return { client, config };
}

/* ------------------------------------------------------------------------- */
/* Test data fetchers (read-only, structure-validated)                       */
/* ------------------------------------------------------------------------- */

/**
 * Fetch N song IDs for use as test fixtures. Uses random sort so the IDs vary
 * across runs (catches hard-coded-ordering bugs). Does NOT modify Navidrome.
 *
 * Throws with a descriptive error if Navidrome returns fewer than `count`
 * songs (likely an empty/misconfigured library — abort fast rather than
 * masking the issue with a partial result).
 */
export async function getTestSongIds(count: number): Promise<string[]> {
  if (count <= 0) {
    throw new Error('getTestSongIds: count must be >= 1');
  }
  const ctx = await setupClientAndConfig();
  const result = await searchSongs(ctx.client, ctx.config, {
    query: '',
    sort: 'random',
    limit: count,
  });
  if (result.songs.length < count) {
    throw new Error(
      `getTestSongIds: requested ${count} songs but Navidrome returned ${result.songs.length}. ` +
        `Library may be empty or filtered too aggressively.`
    );
  }
  return result.songs.slice(0, count).map((song) => song.id);
}

/**
 * Fetch N album IDs for use as test fixtures. Each returned album is
 * guaranteed to have `songCount >= 1` so callers can rely on tracks
 * resolving to a non-empty list. Does NOT modify Navidrome.
 *
 * Throws if fewer than `count` non-empty albums are found.
 */
export async function getTestAlbumIds(count: number): Promise<string[]> {
  if (count <= 0) {
    throw new Error('getTestAlbumIds: count must be >= 1');
  }
  const ctx = await setupClientAndConfig();

  // Over-fetch and filter for non-empty albums. Most albums in a real
  // library are non-empty so over-fetch ratio of 2x is plenty.
  const result = await searchAlbums(ctx.client, ctx.config, {
    query: '',
    sort: 'random',
    limit: Math.max(count * 2, 10),
  });
  const nonEmpty = result.albums.filter((a) => a.songCount >= 1);
  if (nonEmpty.length < count) {
    throw new Error(
      `getTestAlbumIds: requested ${count} non-empty albums but only found ${nonEmpty.length} ` +
        `(of ${result.albums.length} total).`
    );
  }
  return nonEmpty.slice(0, count).map((album) => album.id);
}

/**
 * Fetch the ordered track ID list for an album. Useful for tests that need
 * to assert songCount matches actual track count. Does NOT modify Navidrome.
 */
export async function getAlbumTrackIds(albumId: string): Promise<string[]> {
  const ctx = await setupClientAndConfig();
  // Use the same endpoint shape playback.ts uses internally so the count
  // matches what `play_albums` actually loads into the queue.
  const params = new URLSearchParams({
    album_id: albumId,
    _start: '0',
    _end: '500',
    _sort: 'album',
    _order: 'ASC',
  });
  const raw = await ctx.client.request<unknown>(`/song?${params.toString()}`);
  if (!Array.isArray(raw)) {
    throw new Error(`Unexpected response shape for album ${albumId}`);
  }
  const ids: string[] = [];
  for (const track of raw) {
    if (typeof track === 'object' && track !== null) {
      const id = (track as Record<string, unknown>)['id'];
      if (typeof id === 'string' && id !== '') {
        ids.push(id);
      }
    }
  }
  return ids;
}

/* ------------------------------------------------------------------------- */
/* Async polling helper                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Poll `predicate` every ~75ms until it returns true or the timeout elapses.
 * Throws on timeout with a clear message.
 *
 * Use this instead of fixed `setTimeout` whenever you're waiting on mpv to
 * propagate a property change — mpv timing varies on different hosts and a
 * fixed sleep is either flaky (too short) or slow (too long).
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 75
): Promise<void> {
  const start = Date.now();
  // Best-effort first check before sleeping at all
  if (await predicate()) return;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await predicate()) return;
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/* ------------------------------------------------------------------------- */
/* Tool wrappers                                                             */
/* ------------------------------------------------------------------------- */
//
// These wrappers exist so tests don't have to remember which tools take
// `(client, args)` vs `(client, config, args)` vs `(args)`. Each wrapper
// resolves the shared client/config (cached after first call) and forwards
// to the real exported tool function — so we're testing the production
// signature, not a mock.
//
// All wrappers return the precise tool result shape; callers can inspect
// `success`, `count`, `noop`, etc. exactly as MCP clients would.
//

let cachedContext: TestContext | null = null;

async function ctx(): Promise<TestContext> {
  cachedContext ??= await setupClientAndConfig();
  return cachedContext;
}

export async function playSongs(args: {
  songIds: string[];
  mode?: 'replace' | 'append';
  shuffle?: boolean;
}): Promise<Awaited<ReturnType<typeof playSongsTool>>> {
  const { client } = await ctx();
  return playSongsTool(client, args);
}

export async function playAlbums(args: {
  albumIds: string[];
  mode?: 'replace' | 'append';
  shuffle?: 'none' | 'albums' | 'songs';
}): Promise<Awaited<ReturnType<typeof playAlbumsTool>>> {
  const { client } = await ctx();
  return playAlbumsTool(client, args);
}

/**
 * Run a filter-driven album search and pipe the matched albums into the
 * live play queue. Args mirror `search_albums` plus `mode` and `shuffle`
 * (which is the album-level shuffle enum, not a boolean — matches the
 * production tool signature).
 */
export async function playAlbumsSearch(
  args: Record<string, unknown>
): Promise<Awaited<ReturnType<typeof playAlbumsSearchTool>>> {
  const { client, config } = await ctx();
  return playAlbumsSearchTool(client, config, args);
}

/**
 * Run a filter-driven song search and pipe the matched songs into the
 * live play queue. Args mirror `search_songs` plus `mode` and `shuffle`
 * (boolean here — songs flatten 1:1 to queue items).
 */
export async function playSongsSearch(
  args: Record<string, unknown>
): Promise<Awaited<ReturnType<typeof playSongsSearchTool>>> {
  const { client, config } = await ctx();
  return playSongsSearchTool(client, config, args);
}

export async function getPlayQueue(): Promise<Awaited<ReturnType<typeof getPlayQueueTool>>> {
  return getPlayQueueTool({});
}

export async function clearPlayQueue(): Promise<Awaited<ReturnType<typeof clearPlayQueueTool>>> {
  return clearPlayQueueTool({});
}

export async function shufflePlayQueue(): Promise<Awaited<ReturnType<typeof shufflePlayQueueTool>>> {
  return shufflePlayQueueTool({});
}

export async function moveInPlayQueue(args: {
  from: number;
  to: number;
}): Promise<Awaited<ReturnType<typeof moveInPlayQueueTool>>> {
  return moveInPlayQueueTool(args);
}

export async function removeFromPlayQueue(args: {
  index: number;
}): Promise<Awaited<ReturnType<typeof removeFromPlayQueueTool>>> {
  return removeFromPlayQueueTool(args);
}

export async function pause(): Promise<Awaited<ReturnType<typeof pauseTool>>> {
  return pauseTool({});
}

export async function resume(): Promise<Awaited<ReturnType<typeof resumeTool>>> {
  return resumeTool({});
}

export async function next(): Promise<Awaited<ReturnType<typeof nextTool>>> {
  return nextTool({});
}

export async function previous(): Promise<Awaited<ReturnType<typeof previousTool>>> {
  return previousTool({});
}

export async function seek(args: {
  seconds: number;
  mode?: 'absolute' | 'relative';
}): Promise<Awaited<ReturnType<typeof seekTool>>> {
  return seekTool(args);
}

export async function setVolume(args: {
  level: number;
}): Promise<Awaited<ReturnType<typeof setVolumeTool>>> {
  return setVolumeTool(args);
}

export async function nowPlaying(): Promise<Awaited<ReturnType<typeof nowPlayingTool>>> {
  return nowPlayingTool({});
}

export async function playbackStatus(): Promise<PlaybackStatus> {
  return playbackStatusTool({});
}

/**
 * Play a saved Navidrome radio station through mpv. Wraps the
 * production `play_radio_station` tool. Replaces the entire queue with
 * this single radio stream (per radio mutual-exclusion rule).
 */
export async function playRadioStation(args: {
  id: string;
}): Promise<Awaited<ReturnType<typeof playRadioStationTool>>> {
  const { config } = await ctx();
  return playRadioStationTool(config, args);
}

/**
 * Pick a radio station ID for tests. Lists stations from Navidrome and
 * returns the first one whose stream URL matches a known-reliable host
 * pattern (SomaFM is a stable, free-to-stream service that's commonly
 * present in test libraries). Falls back to the first station if no
 * match. Throws if the user has zero saved stations.
 */
export async function getTestRadioStationId(): Promise<string> {
  const { config } = await ctx();
  const result = await listRadioStationsTool(config, {});
  if (result.stations.length === 0) {
    throw new Error('No radio stations are saved in Navidrome — radio tests require at least one');
  }
  // Prefer SomaFM streams when available (consistently reliable).
  const somaFm = result.stations.find(s => /soma(fm|\.fm)/i.test(s.streamUrl));
  if (somaFm !== undefined) {
    return somaFm.id;
  }
  // Otherwise prefer streams that look like real HTTPS Icecast/SHOUTcast.
  // Filter out fake/test entries with hosts containing "fake" or "test".
  const realLooking = result.stations.find(s =>
    s.streamUrl.startsWith('https://') && !/fake|test\./i.test(s.streamUrl)
  );
  if (realLooking !== undefined) {
    return realLooking.id;
  }
  // Last resort: first station, even if it's a fake URL — tests that
  // exercise structural assertions (queue-shape, mutual exclusion) don't
  // depend on actual audio playback.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return result.stations[0]!.id;
}
