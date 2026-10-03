/**
 * Navidrome MCP Server - now_playing title reconciliation / leak tests
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

/**
 * Regression for Issue #3 — `now_playing` leaked the raw Subsonic stream URL
 * (with auth token `t` + salt `s`) in `title` during the brief track-load
 * window, before mpv reads file metadata. These tests drive the engine into
 * that window and assert the credential-bearing URL never reaches the result,
 * and that title/artist/album are reconciled by songId instead.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { nowPlaying, resetNowPlayingCache } from '../../../src/tools/playback.js';

// A realistic credential-bearing stream URL, shaped like what mpv reports as
// `media-title` before metadata loads. Contains the auth token + salt.
const LEAKY_URL =
  'http://192.168.86.100:4533/rest/stream?u=blake&t=c7d099345f8b1a2b3c4d5e6f&s=603dbb5c&id=song-123&format=raw';
// mpv's filename fallback for the same stream: the URL-unescaped basename, with no scheme.
const LEAKY_BASENAME = 'stream?u=blake&t=c7d099345f8b1a2b3c4d5e6f&s=603dbb5c&id=song-123&format=raw';

const ensureAttachedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const getStatusMock = vi.hoisted(() => vi.fn());
const getCachedPropertyMock = vi.hoisted(() => vi.fn());
const getQueueGenerationMock = vi.hoisted(() => vi.fn());
const getQueueMock = vi.hoisted(() => vi.fn());
const ingestQueueMetadataMock = vi.hoisted(() => vi.fn());
const getRadioStationTagMock = vi.hoisted(() => vi.fn().mockReturnValue(null));
// Mirrors the engine's parse: only a Subsonic stream URL names a song.
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

/** Build a getCachedProperty implementation from a property map. */
function cachedProps(props: Record<string, unknown>): (name: string) => unknown {
  return (name: string) => props[name];
}

describe('now_playing title reconciliation (Issue #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetNowPlayingCache();
    getStatusMock.mockReturnValue({ engineRunning: true });
    getQueueGenerationMock.mockReturnValue(0);
  });

  it('suppresses a URL-shaped media-title and reconciles the real title by songId', async () => {
    // Track-load window: mpv reports the stream URL as media-title, no metadata
    // yet. The current queue entry carries the cache-resolved title/artist/album.
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 3,
        pause: false,
        'time-pos': 1,
        duration: 200,
        'media-title': LEAKY_URL,
        metadata: null,
      }),
    );
    getQueueMock.mockResolvedValue([
      {
        index: 0,
        songId: 'song-123',
        isCurrent: true,
        isPlaying: true,
        title: 'Real Song Title',
        artist: 'Real Artist',
        album: 'Real Album',
        duration: 200,
      },
    ]);

    const result = await nowPlaying({});

    expect(result.title).toBe('Real Song Title');
    expect(result.artist).toBe('Real Artist');
    expect(result.album).toBe('Real Album');
    // The token/salt must NEVER appear anywhere in the serialized result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('c7d099345f8b1a2b3c4d5e6f');
    expect(serialized).not.toContain('603dbb5c');
    expect(serialized).not.toContain('stream?u=');
  });

  it('suppresses the filename-fallback basename media-title and reconciles the real title by songId', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 0,
        duration: 200,
        'media-title': LEAKY_BASENAME,
        metadata: null,
      }),
    );
    getQueueMock.mockResolvedValue([
      { index: 0, songId: 'song-123', isCurrent: true, isPlaying: true, title: 'Real Song Title', artist: 'Real Artist', duration: 200 },
    ]);

    const result = await nowPlaying({});

    expect(result.title).toBe('Real Song Title');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('c7d099345f8b1a2b3c4d5e6f');
    expect(serialized).not.toContain('stream?u=');
  });

  it('never emits a URL-shaped title even if the queue entry also lacks a clean title (no client)', async () => {
    // Pathological: cache empty AND no client to fall back to. Title must be
    // omitted entirely rather than leaking the URL.
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 0,
        duration: 0,
        'media-title': LEAKY_URL,
        metadata: null,
      }),
    );
    getQueueMock.mockResolvedValue([
      { index: 0, songId: 'song-123', isCurrent: true, isPlaying: true },
    ]);

    const result = await nowPlaying({});

    expect(result.title).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('stream?u=');
  });

  it('falls back to a single Navidrome lookup when the cache is empty (post-restart)', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 0,
        duration: 0,
        'media-title': LEAKY_URL,
        metadata: null,
      }),
    );
    // Engine cache lost on restart: current entry has no title/artist/album.
    getQueueMock.mockResolvedValue([
      { index: 0, songId: 'song-123', isCurrent: true, isPlaying: true },
    ]);
    // Mock client returns the song row for the Navidrome fallback.
    const client = {
      request: vi.fn().mockResolvedValue([
        { id: 'song-123', title: 'Restored Title', artist: 'Restored Artist', album: 'Restored Album', duration: 200 },
      ]),
    } as unknown as Parameters<typeof nowPlaying>[1];

    const result = await nowPlaying({}, client);

    expect(result.title).toBe('Restored Title');
    expect(result.artist).toBe('Restored Artist');
    expect(ingestQueueMetadataMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('stream?u=');
  });

  it('passes a normal (non-URL) media-title through untouched', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 30,
        duration: 200,
        'media-title': 'Steady State Song',
        metadata: { artist: 'Some Artist', album: 'Some Album' },
      }),
    );
    getQueueMock.mockResolvedValue([
      {
        index: 0,
        songId: 'song-9',
        isCurrent: true,
        isPlaying: true,
        title: 'Steady State Song',
        artist: 'Some Artist',
        album: 'Some Album',
        duration: 200,
      },
    ]);

    const result = await nowPlaying({});

    expect(result.title).toBe('Steady State Song');
    expect(result.artist).toBe('Some Artist');
    expect(result.album).toBe('Some Album');
  });

  it('names a radio stream from the saved station with its URL, then skips getQueue', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([{ id: 'r1', name: 'SomaFM Groove Salad', streamUrl }]);

    const first = await nowPlaying({}, client);
    const second = await nowPlaying({}, client);

    expect(first.title).toBe('Galimatias - Purple Rain');
    expect(first.isRadio).toBe(true);
    expect(first.radioStation).toEqual({ name: 'SomaFM Groove Salad' });
    expect(second.radioStation).toEqual({ name: 'SomaFM Groove Salad' });
    expect(getQueueMock).toHaveBeenCalledTimes(1);
  });

  it('names the tagged station when two saved stations share the stream URL', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    getRadioStationTagMock.mockReturnValueOnce('r2');
    const client = radioClient([
      { id: 'r1', name: 'Groove Salad', streamUrl },
      { id: 'r2', name: 'Groove Salad copy', streamUrl },
    ]);

    const result = await nowPlaying({}, client);

    expect(result.radioStation).toEqual({ name: 'Groove Salad copy' });
  });

  it('names the first station with the URL when the tag names a station on another stream', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    getRadioStationTagMock.mockReturnValueOnce('r3');
    const client = radioClient([
      { id: 'r1', name: 'Groove Salad', streamUrl },
      { id: 'r2', name: 'Groove Salad copy', streamUrl },
      { id: 'r3', name: 'Drone Zone', streamUrl: 'http://ice.somafm.com/dronezone' },
    ]);

    const result = await nowPlaying({}, client);

    expect(result.radioStation).toEqual({ name: 'Groove Salad' });
  });

  it('renames the station when another process tags a second station on the same URL, index and generation', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([
      { id: 'r1', name: 'Groove Salad', streamUrl },
      { id: 'r2', name: 'Groove Salad copy', streamUrl },
    ]);

    getRadioStationTagMock.mockReturnValueOnce('r1');
    const first = await nowPlaying({}, client);
    getRadioStationTagMock.mockReturnValueOnce('r2');
    const second = await nowPlaying({}, client);

    expect(first.radioStation).toEqual({ name: 'Groove Salad' });
    expect(second.radioStation).toEqual({ name: 'Groove Salad copy' });
  });

  it('omits the buffered duration and the songId of a radio stream on every poll', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    const props = radioProps(streamUrl);
    getCachedPropertyMock.mockImplementation((name: string) => (name === 'duration' ? 17.4 : props(name)));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([{ id: 'r1', name: 'SomaFM Groove Salad', streamUrl }]);

    const first = await nowPlaying({}, client);
    const second = await nowPlaying({}, client);

    expect(first.duration).toBeUndefined();
    expect(second.duration).toBeUndefined();
    expect(first.songId).toBeUndefined();
  });

  it('reports the songId of the loaded song stream', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 1,
        'playlist-count': 3,
        pause: false,
        duration: 200,
        'media-title': 'Real Title',
        metadata: { artist: 'Real Artist' },
        path: LEAKY_URL,
      }),
    );
    getQueueMock.mockResolvedValue([
      { index: 1, songId: 'song-123', isCurrent: true, isPlaying: true, duration: 200 },
    ]);

    const result = await nowPlaying({});

    expect(result.songId).toBe('song-123');
  });

  it('omits paused when no entry is current', async () => {
    getCachedPropertyMock.mockImplementation(cachedProps({ 'playlist-pos': -1, 'playlist-count': 0, pause: true }));

    const result = await nowPlaying({});

    expect(result.queueIndex).toBe(-1);
    expect(result.paused).toBeUndefined();
  });

  it('names no station while the cached path still holds the replaced song', async () => {
    const streamUrl = 'http://ice.somafm.com/groovesalad';
    const songPath = 'http://navidrome.test/rest/stream?id=song-1&u=user&t=token&s=salt';
    getCachedPropertyMock.mockImplementation(radioProps(songPath));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([{ id: 'r1', name: 'SomaFM Groove Salad', streamUrl }]);

    const stale = await nowPlaying({}, client);
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    const settled = await nowPlaying({}, client);

    expect(stale.radioStation).toBeUndefined();
    expect(settled.radioStation).toEqual({ name: 'SomaFM Groove Salad' });
  });

  it('labels a radio stream that matches no saved station "Unknown station"', async () => {
    getCachedPropertyMock.mockImplementation(radioProps('http://unsaved.example/stream'));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([{ id: 'r1', name: 'Other', streamUrl: 'http://other.example/stream' }]);

    const result = await nowPlaying({}, client);

    expect(result.isRadio).toBe(true);
    expect(result.radioStation).toEqual({ name: 'Unknown station' });
  });

  it('names a playlist-file station by mpv playlist-path when path is the expanded URL', async () => {
    const props = radioProps('http://expanded.example/live');
    getCachedPropertyMock.mockImplementation((name: string) =>
      name === 'playlist-path' ? 'http://saved.example/station.pls' : props(name),
    );
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = radioClient([{ id: 'r1', name: 'Saved', streamUrl: 'http://saved.example/station.pls' }]);

    const result = await nowPlaying({}, client);

    expect(result.radioStation).toEqual({ name: 'Saved' });
  });

  it('labels a radio stream "Unknown station" when the station list read fails', async () => {
    getCachedPropertyMock.mockImplementation(radioProps('http://reject.example/stream'));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const client = { request: vi.fn().mockRejectedValue(new Error('Navidrome down')) } as unknown as NavidromeClient;

    const result = await nowPlaying({}, client);

    expect(result.radioStation).toEqual({ name: 'Unknown station' });
  });

  it('retries a failed station read on the next poll instead of keeping "Unknown station"', async () => {
    const streamUrl = 'http://retry.example/stream';
    getCachedPropertyMock.mockImplementation(radioProps(streamUrl));
    getQueueMock.mockResolvedValue([{ index: 0, songId: null, isCurrent: true, isPlaying: true }]);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error('Navidrome down'))
      .mockResolvedValueOnce([{ id: 'r1', name: 'Recovered Station', streamUrl }]);
    const client = { request } as unknown as NavidromeClient;

    const first = await nowPlaying({}, client);
    const second = await nowPlaying({}, client);

    expect(first.radioStation).toEqual({ name: 'Unknown station' });
    expect(second.radioStation).toEqual({ name: 'Recovered Station' });
  });

  it('keeps mpv cached properties when the queue read fails', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        'media-title': 'Song',
        duration: 200,
        path: 'http://nd.test/rest/stream?id=song-1&u=a&t=b&s=c',
      }),
    );
    getQueueMock.mockRejectedValueOnce(new Error('ipc'));

    const result = await nowPlaying({});

    expect(result.title).toBe('Song');
    expect(result.duration).toBe(200);
  });

  it('omits the buffered duration of a radio stream when the queue read fails', async () => {
    const props = radioProps('http://ice.somafm.com/groovesalad');
    getCachedPropertyMock.mockImplementation((name: string) => (name === 'duration' ? 17.4 : props(name)));
    getQueueMock.mockRejectedValueOnce(new Error('ipc'));

    const result = await nowPlaying({});

    expect(result.duration).toBeUndefined();
  });

  it('resolves without metadata when the Navidrome lookup fails', async () => {
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 0,
        duration: 0,
        'media-title': LEAKY_URL,
        metadata: null,
        path: '/fail/navidrome',
      }),
    );
    getQueueMock.mockResolvedValue([{ index: 0, songId: 'song-123', isCurrent: true, isPlaying: true }]);
    const client = { request: vi.fn().mockRejectedValue(new Error('Navidrome down')) } as unknown as NavidromeClient;

    const result = await nowPlaying({}, client);

    expect(result.title).toBeUndefined();
    expect(ingestQueueMetadataMock).not.toHaveBeenCalled();
  });
});

function radioProps(path: string): (name: string) => unknown {
  return cachedProps({
    'playlist-pos': 0,
    'playlist-count': 1,
    pause: false,
    'time-pos': 12,
    duration: 0,
    'media-title': 'Galimatias - Purple Rain',
    metadata: { 'icy-name': 'Groove Salad' },
    path,
  });
}

function radioClient(rows: Array<{ id: string; name: string; streamUrl: string }>): NavidromeClient {
  return { request: vi.fn().mockResolvedValue(rows) } as unknown as NavidromeClient;
}
