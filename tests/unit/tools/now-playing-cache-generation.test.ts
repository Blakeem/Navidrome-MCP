/**
 * Navidrome MCP Server - now_playing per-position cache keying tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * The now_playing repair cache keys on queue generation, index, loaded path and station tag, so a
 * file loaded at a reused index never inherits the previous file's facts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { nowPlaying, resetNowPlayingCache } from '../../../src/tools/playback.js';

const ensureAttachedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getStatusMock = vi.hoisted(() => vi.fn());
const getCachedPropertyMock = vi.hoisted(() => vi.fn());
const getQueueGenerationMock = vi.hoisted(() => vi.fn());
const getQueueMock = vi.hoisted(() => vi.fn());
const ingestQueueMetadataMock = vi.hoisted(() => vi.fn());
const getRadioStationTagMock = vi.hoisted(() => vi.fn().mockReturnValue(null));
// Mirrors the engine's parse, where only a Subsonic stream URL names a song.
const songIdForPathMock = vi.hoisted(() =>
  vi.fn((path: string): string | null => {
    try {
      const url = new URL(path);
      return url.pathname.endsWith('/rest/stream') ? url.searchParams.get('id') : null;
    } catch {
      return null;
    }
  }),
);

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    ensureAttached: ensureAttachedMock,
    getStatus: getStatusMock,
    getCachedProperty: getCachedPropertyMock,
    getQueueGeneration: getQueueGenerationMock,
    getQueue: getQueueMock,
    ingestQueueMetadata: ingestQueueMetadataMock,
    getRadioStationTag: getRadioStationTagMock,
    songIdForPath: songIdForPathMock,
  },
}));

function cachedProps(props: Record<string, unknown>): (name: string) => unknown {
  return (name: string) => props[name];
}

describe('now_playing per-position cache keying', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNowPlayingCache();
    getStatusMock.mockReturnValue({ engineRunning: true });
  });

  it('re-repairs duration after a replace reload lands a new track at index 0, and skips getQueue once resolved', async () => {
    // Poll 1: mpv under-reports the VBR duration as 100 against Navidrome's 300.
    getQueueGenerationMock.mockReturnValue(10);
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 3,
        pause: false,
        'time-pos': 2,
        duration: 100,
        'media-title': 'Track A',
        metadata: { artist: 'Artist A' },
        path: 'http://nd.local/rest/stream?id=A',
      }),
    );
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 'A', isCurrent: true, isPlaying: true, title: 'Track A', artist: 'Artist A', album: 'Album A', duration: 300 },
    ]);

    const poll1 = await nowPlaying({});
    expect(poll1.duration).toBe(300);
    expect(getQueueMock).toHaveBeenCalledTimes(1);

    // Poll 2: the cache holds the duration and the not-radio fact, so getQueue must not fire.
    const poll2 = await nowPlaying({});
    expect(getQueueMock).toHaveBeenCalledTimes(1);
    expect(poll2.isRadio).toBeUndefined();
    expect(poll2.duration).toBe(300);

    // Poll 3: a replace reload bumps the generation and puts track B at index 0, so track B must
    // not inherit track A's cached duration.
    getQueueGenerationMock.mockReturnValue(11);
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 3,
        pause: false,
        'time-pos': 2,
        duration: 100,
        'media-title': 'Track B',
        metadata: { artist: 'Artist B' },
        path: 'http://nd.local/rest/stream?id=B',
      }),
    );
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 'B', isCurrent: true, isPlaying: true, title: 'Track B', artist: 'Artist B', album: 'Album B', duration: 280 },
    ]);

    const poll3 = await nowPlaying({});
    expect(poll3.duration).toBe(280);
    expect(getQueueMock).toHaveBeenCalledTimes(2);
  });

  it('does not reapply a cached duration when a new file loads at the same generation and index', async () => {
    // Another process sharing mpv, or removal of the playing entry, loads a new
    // file at index 0 without bumping this process's generation.
    getQueueGenerationMock.mockReturnValue(20);
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 3,
        duration: 100,
        'media-title': 'Track C',
        metadata: { artist: 'Artist C' },
        path: 'http://nd.local/rest/stream?id=C',
      }),
    );
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 'C', isCurrent: true, isPlaying: true, title: 'Track C', artist: 'Artist C', duration: 400 },
    ]);
    const poll1 = await nowPlaying({});
    expect(poll1.duration).toBe(400);

    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 3,
        duration: 200,
        'media-title': 'Track D',
        metadata: { artist: 'Artist D' },
        path: 'http://nd.local/rest/stream?id=D',
      }),
    );
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 'D', isCurrent: true, isPlaying: true, title: 'Track D', artist: 'Artist D', duration: 200 },
    ]);
    const poll2 = await nowPlaying({});
    expect(poll2.duration).toBe(200);
    expect(getQueueMock).toHaveBeenCalledTimes(2);

    // A radio stream loaded the same way reports no duration and must not inherit one.
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        'media-title': 'Some Station',
        path: 'http://radio.example/stream',
      }),
    );
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: null, isCurrent: true, isPlaying: true, title: 'Some Station' },
    ]);
    const poll3 = await nowPlaying({});
    expect(poll3.duration).toBeUndefined();
    expect(poll3.isRadio).toBe(true);
    expect(getQueueMock).toHaveBeenCalledTimes(3);
  });

  it('merges and caches nothing when mpv already moved to another entry before the queue read', async () => {
    getQueueGenerationMock.mockReturnValue(30);
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 4,
        'playlist-count': 8,
        duration: 100,
        'media-title': 'Track Four',
        path: 'http://nd.local/rest/stream?id=4',
      }),
    );
    getQueueMock.mockResolvedValue([
      { index: 4, songId: '4', isCurrent: false, isPlaying: false },
      { index: 5, songId: '5', isCurrent: true, isPlaying: true, title: 'Track Five', artist: 'Artist Five', duration: 400 },
    ]);

    const poll1 = await nowPlaying({});
    expect(poll1.title).toBe('Track Four');
    expect(poll1.artist).toBeUndefined();
    expect(poll1.duration).toBe(100);

    await nowPlaying({});
    expect(getQueueMock).toHaveBeenCalledTimes(2);
  });

  it('applies the Navidrome duration on a cold engine cache when mpv supplies title and artist', async () => {
    getQueueGenerationMock.mockReturnValue(40);
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        duration: 200,
        'media-title': 'Track E',
        metadata: { artist: 'Artist E' },
        path: 'http://nd.local/rest/stream?id=E',
      }),
    );
    getQueueMock.mockResolvedValue([{ index: 0, songId: 'E', isCurrent: true, isPlaying: true, title: 'Track E' }]);
    const client = {
      request: vi.fn().mockResolvedValue([{ id: 'E', title: 'Track E', artist: 'Artist E', duration: 230 }]),
    } as unknown as NavidromeClient;

    const poll1 = await nowPlaying({}, client);
    const poll2 = await nowPlaying({}, client);

    expect(poll1.duration).toBe(230);
    expect(poll2.duration).toBe(230);
    expect(getQueueMock).toHaveBeenCalledTimes(1);
  });
});
