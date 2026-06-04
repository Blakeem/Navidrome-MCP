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

// A realistic credential-bearing stream URL, shaped like what mpv reports as
// `media-title` before metadata loads. Contains the auth token + salt.
const LEAKY_URL =
  'http://192.168.86.100:4533/rest/stream?u=blake&t=c7d099345f8b1a2b3c4d5e6f&s=603dbb5c&id=song-123&format=raw';

const ensureAttachedMock = vi.fn().mockResolvedValue(undefined);
const getStatusMock = vi.fn();
const getCachedPropertyMock = vi.fn();
const getCurrentRadioStationMock = vi.fn();
const getPlaylistMock = vi.fn();
const ingestQueueMetadataMock = vi.fn();

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    ensureAttached: ensureAttachedMock,
    getStatus: getStatusMock,
    getCachedProperty: getCachedPropertyMock,
    getCurrentRadioStation: getCurrentRadioStationMock,
    getPlaylist: getPlaylistMock,
    ingestQueueMetadata: ingestQueueMetadataMock,
  },
}));

const { nowPlaying } = await import('../../../src/tools/playback.js');

/** Build a getCachedProperty implementation from a property map. */
function cachedProps(props: Record<string, unknown>): (name: string) => unknown {
  return (name: string) => props[name];
}

describe('now_playing title reconciliation (Issue #3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatusMock.mockReturnValue({ engineRunning: true });
    getCurrentRadioStationMock.mockReturnValue(null);
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
    getPlaylistMock.mockResolvedValue([
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
    getPlaylistMock.mockResolvedValue([
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
    getPlaylistMock.mockResolvedValue([
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
    getPlaylistMock.mockResolvedValue([
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

  it('passes an ICY radio title (Artist - Track) through and flags isRadio', async () => {
    getCurrentRadioStationMock.mockReturnValue({ name: 'SomaFM Groove Salad' });
    getCachedPropertyMock.mockImplementation(
      cachedProps({
        'playlist-pos': 0,
        'playlist-count': 1,
        pause: false,
        'time-pos': 12,
        duration: 0,
        'media-title': 'Galimatias - Purple Rain',
        metadata: { 'icy-name': 'Groove Salad' },
      }),
    );

    const result = await nowPlaying({});

    expect(result.title).toBe('Galimatias - Purple Rain');
    expect(result.isRadio).toBe(true);
    expect(result.radioStation).toEqual({ name: 'SomaFM Groove Salad' });
    // Radio path should not call getPlaylist (station known, no album to repair).
    expect(getPlaylistMock).not.toHaveBeenCalled();
  });
});
