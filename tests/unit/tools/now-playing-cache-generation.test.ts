/**
 * Navidrome MCP Server - now_playing per-position cache keying tests
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
 * Regression for the duration-repair / not-radio caches in `now_playing`.
 *
 *  - src-tools-playback-ts-1: the VBR duration-repair cache was keyed only by
 *    queue index (`idx:0`). A `mode:'replace'` reload always lands the new track
 *    at index 0, so the incoming track collided with the previous track's cached
 *    repair state and its VBR duration was never reconciled. Folding the engine's
 *    queue-generation counter into the key fixes the collision.
 *  - src-tools-playback-ts-2: `needsRadioFallback` was unconditionally true for
 *    all non-radio playback, forcing a getQueue() IPC on every poll even once
 *    duration + metadata were fully resolved. Confirming "not radio" once per
 *    (generation, position) lets the poll skip the IPC.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureAttachedMock = vi.fn().mockResolvedValue(undefined);
const getStatusMock = vi.fn();
const getCachedPropertyMock = vi.fn();
const getCurrentRadioStationMock = vi.fn();
const getQueueGenerationMock = vi.fn();
const getQueueMock = vi.fn();
const ingestQueueMetadataMock = vi.fn();

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    ensureAttached: ensureAttachedMock,
    getStatus: getStatusMock,
    getCachedProperty: getCachedPropertyMock,
    getCurrentRadioStation: getCurrentRadioStationMock,
    getQueueGeneration: getQueueGenerationMock,
    getQueue: getQueueMock,
    ingestQueueMetadata: ingestQueueMetadataMock,
  },
}));

const { nowPlaying } = await import('../../../src/tools/playback.js');

/** Cached-property map for a clean, non-radio track under VBR duration report. */
function cachedProps(props: Record<string, unknown>): (name: string) => unknown {
  return (name: string) => props[name];
}

describe('now_playing per-position cache keying', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getStatusMock.mockReturnValue({ engineRunning: true });
    getCurrentRadioStationMock.mockReturnValue(null);
  });

  it('re-repairs duration after a replace reload lands a new track at index 0, and skips getQueue once resolved', async () => {
    // ---- Poll 1: generation 10, index 0. mpv under-reports VBR duration (100),
    // Navidrome's authoritative value is 300. Title/artist are already present
    // so the only reason to call getQueue is the duration repair.
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

    // ---- Poll 2: same generation + index. Duration already repaired and the
    // position is confirmed not-radio, so getQueue must NOT fire again
    // (pins src-tools-playback-ts-2 — needsRadioFallback no longer forces it).
    const poll2 = await nowPlaying({});
    expect(getQueueMock).toHaveBeenCalledTimes(1);
    expect(poll2.isRadio).toBeUndefined();
    expect(poll2.duration).toBe(300);

    // ---- Poll 3: a mode:'replace' reload bumps the generation to 11. Track B
    // now occupies index 0 and mpv again under-reports its VBR duration (100).
    // Because the key folds the generation, B does NOT inherit A's cached repair
    // state, so getQueue fires and B's duration is reconciled to 280.
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
});
