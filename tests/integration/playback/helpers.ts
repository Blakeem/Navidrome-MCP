/**
 * Navidrome MCP Server - Playback Integration Test Helpers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * These helpers read Navidrome only through search and get endpoints, so a playback run never
 * modifies server data. Every write lands on the local mpv process.
 */

import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import { loadConfig } from '../../../src/config.js';
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
import { isMpvAvailable, shouldSkipLiveTests } from '../../helpers/env-detection.js';
import { getSharedLiveClient } from '../../factories/shared-client.js';

const mpvAvailable: boolean = isMpvAvailable();

function shouldSkipPlaybackTests(): boolean {
  return shouldSkipLiveTests() || !mpvAvailable;
}

function getPlaybackSkipReason(): string {
  if (!mpvAvailable) {
    return 'mpv not found (install mpv on PATH or set playback.mpvPath in settings.json)';
  }
  return 'live tests disabled (no Navidrome config or CI without server)';
}

export function describePlayback(name: string, fn: () => void): void {
  if (shouldSkipPlaybackTests()) {
    describe.skip(`${name} (skipped: ${getPlaybackSkipReason()})`, fn);
  } else {
    describe(name, fn);
  }
}

export function itPlayback(name: string, fn: () => void | Promise<void>): void {
  if (shouldSkipPlaybackTests()) {
    it.skip(`${name} (skipped: ${getPlaybackSkipReason()})`, fn);
  } else {
    it(name, fn);
  }
}

interface TestContext {
  client: NavidromeClient;
  config: Config;
}

export async function setupClientAndConfig(): Promise<TestContext> {
  const client = await getSharedLiveClient();
  const config = await loadConfig();
  // configure() only overwrites the engine's config and mpv path, so a call per suite is harmless.
  playbackEngine.configure(config);
  return { client, config };
}

/** Random sort varies the fixtures per run, so no test can pass by relying on one library order. */
export async function getTestSongIds(count: number): Promise<string[]> {
  if (count <= 0) {
    throw new Error('getTestSongIds: count must be >= 1');
  }
  const ctx = await setupClientAndConfig();
  const result = await searchSongs(ctx.client, {
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

export async function getTestAlbumIds(count: number): Promise<string[]> {
  if (count <= 0) {
    throw new Error('getTestAlbumIds: count must be >= 1');
  }
  const ctx = await setupClientAndConfig();

  // Most albums in a real library hold songs, so a 2x over-fetch survives dropping the empty ones.
  const result = await searchAlbums(ctx.client, {
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
 * Mirrors the /song read in fetchAlbumSetSongs, so the result matches what play_albums queues for
 * an album under 500 tracks.
 */
export async function getAlbumTrackIds(albumId: string): Promise<string[]> {
  const ctx = await setupClientAndConfig();
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

/** mpv timing varies by host, so polling replaces a fixed sleep that is either flaky or slow. */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 75
): Promise<void> {
  const start = Date.now();
  if (await predicate()) return;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (await predicate()) return;
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

// The wrappers hide which tools take a client, and each one calls the real exported tool, so tests
// exercise production code with the result shape an MCP client sees.
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
  shuffleAlbums?: boolean;
  shuffleSongs?: boolean;
}): Promise<Awaited<ReturnType<typeof playAlbumsTool>>> {
  const { client } = await ctx();
  return playAlbumsTool(client, args);
}

export async function playAlbumsSearch(
  args: Record<string, unknown>
): Promise<Awaited<ReturnType<typeof playAlbumsSearchTool>>> {
  const { client } = await ctx();
  return playAlbumsSearchTool(client, args);
}

export async function playSongsSearch(
  args: Record<string, unknown>
): Promise<Awaited<ReturnType<typeof playSongsSearchTool>>> {
  const { client } = await ctx();
  return playSongsSearchTool(client, args);
}

export async function getPlayQueue(): Promise<Awaited<ReturnType<typeof getPlayQueueTool>>> {
  const { client } = await ctx();
  return getPlayQueueTool(client, {});
}

export async function clearPlayQueue(): Promise<Awaited<ReturnType<typeof clearPlayQueueTool>>> {
  return clearPlayQueueTool({});
}

/** A stopped engine counts as empty, since clear_play_queue never spawns mpv. */
export async function clearQueueAndWait(): Promise<void> {
  await clearPlayQueue();
  await waitFor(async () => {
    const np = await nowPlayingTool({});
    return np.engineRunning === false || np.queueLength === 0;
  });
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

/** Passes the client like the MCP handler does, so radio station names resolve. */
export async function nowPlaying(): Promise<Awaited<ReturnType<typeof nowPlayingTool>>> {
  const { client } = await ctx();
  return nowPlayingTool({}, client);
}

export async function playbackStatus(): Promise<PlaybackStatus> {
  return playbackStatusTool({});
}

export async function playRadioStation(args: {
  stationId: string;
}): Promise<Awaited<ReturnType<typeof playRadioStationTool>>> {
  const { client } = await ctx();
  return playRadioStationTool(client, args);
}

/** SomaFM streams are free and stable, so they come first. The fallback skips fake-looking URLs. */
export async function getTestRadioStationId(): Promise<string> {
  const { client } = await ctx();
  const result = await listRadioStationsTool(client, {});
  if (result.stations.length === 0) {
    throw new Error('No radio stations are saved in Navidrome — radio tests require at least one');
  }
  const somaFm = result.stations.find(s => /soma(fm|\.fm)/i.test(s.streamUrl));
  if (somaFm !== undefined) {
    return somaFm.id;
  }
  const realLooking = result.stations.find(s =>
    s.streamUrl.startsWith('https://') && !/fake|test\./i.test(s.streamUrl)
  );
  if (realLooking !== undefined) {
    return realLooking.id;
  }
  // A fake URL is the last resort, since tests that need mpv to load the stream may fail on it.
  return result.stations[0]!.id;
}
