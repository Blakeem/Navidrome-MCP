/**
 * Navidrome MCP Server - playStarredSongs tests
 * Copyright (C) 2025
 *
 * Covers the web-remote `play_starred_songs` impl: the exported
 * `PlayStarredSongsSchema`, the paginated `fetchStarredSongIds` helper (via the
 * impl), and the shuffle / mode / empty-set paths. The playbackEngine is mocked
 * so no real mpv is touched — end-to-end mpv behavior is covered by the playback
 * integration suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const enqueueMock = vi.fn().mockResolvedValue({ demoted: false });
const ensureRunningMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    enqueue: enqueueMock,
    ensureRunning: ensureRunningMock,
    isRunning: () => true,
    getCurrentRadioStation: () => null,
  },
}));

const { playStarredSongs, PlayStarredSongsSchema } = await import('../../../src/tools/playback.js');

function songPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `song-${start + i}`,
    title: `Title ${start + i}`,
    artist: `Artist ${start + i}`,
    album: `Album ${start + i}`,
    duration: 180,
  }));
}

describe('play_starred_songs', () => {
  let client: MockNavidromeClient;

  beforeEach(() => {
    client = createMockClient();
    enqueueMock.mockClear();
    enqueueMock.mockResolvedValue({ demoted: false });
    ensureRunningMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------
  // Happy path + query params
  // ---------------------------------------------------------------------

  it('enqueues a single page of starred songs with full metadata', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 12), total: 12 });

    const result = await playStarredSongs(client as never, { mode: 'replace', shuffle: false });

    expect(result.success).toBe(true);
    expect(result.count).toBe(12);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);

    const expectedIds = Array.from({ length: 12 }, (_, i) => `song-${i}`);
    const expectedMetadata = expectedIds.map((id, i) => ({
      songId: id,
      title: `Title ${i}`,
      artist: `Artist ${i}`,
      album: `Album ${i}`,
      duration: 180,
    }));
    expect(enqueueMock).toHaveBeenCalledWith(expectedIds, 'replace', expectedMetadata);
  });

  it('requests starred=true sorted by playDate ASC', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 1), total: 1 });

    await playStarredSongs(client as never, {});

    const endpoint = client.requestWithLibraryFilterAndMeta.mock.calls[0]?.[0] as string;
    expect(endpoint).toContain('/song?');
    expect(endpoint).toContain('starred=true');
    expect(endpoint).toContain('_sort=playDate');
    expect(endpoint).toContain('_order=ASC');
  });

  // ---------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------

  it('paginates a 1500-song starred set using X-Total-Count', async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: songPage(0, 500), total: 1500 })
      .mockResolvedValueOnce({ data: songPage(500, 500), total: 1500 })
      .mockResolvedValueOnce({ data: songPage(1000, 500), total: 1500 });

    const result = await playStarredSongs(client as never, {});

    expect(result.success).toBe(true);
    expect(result.count).toBe(1500);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(3);

    const calls = client.requestWithLibraryFilterAndMeta.mock.calls.map((c) => c[0]);
    expect(calls[0]).toContain('_start=0');
    expect(calls[0]).toContain('_end=500');
    expect(calls[1]).toContain('_start=500');
    expect(calls[1]).toContain('_end=1000');
    expect(calls[2]).toContain('_start=1000');
    expect(calls[2]).toContain('_end=1500');

    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueued.length).toBe(1500);
    expect(enqueued[0]).toBe('song-0');
    expect(enqueued.at(-1)).toBe('song-1499');
  });

  it('falls back to short-page heuristic when X-Total-Count is missing', async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: songPage(0, 500), total: null })
      .mockResolvedValueOnce({ data: songPage(500, 73), total: null });

    const result = await playStarredSongs(client as never, {});

    expect(result.success).toBe(true);
    expect(result.count).toBe(573);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(2);
  });

  // ---------------------------------------------------------------------
  // shuffle
  // ---------------------------------------------------------------------

  it('shuffle:true preserves the multiset but permutes order', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 50), total: 50 });

    await playStarredSongs(client as never, { shuffle: true });

    const enqueuedIds = enqueueMock.mock.calls[0]?.[0] as string[];
    const baselineIds = Array.from({ length: 50 }, (_, i) => `song-${i}`);
    expect(new Set(enqueuedIds)).toEqual(new Set(baselineIds));
    expect(enqueuedIds).not.toEqual(baselineIds);
  });

  it('shuffle:false preserves the playDate-ASC order', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 10), total: 10 });

    await playStarredSongs(client as never, { shuffle: false });

    const enqueuedIds = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueuedIds).toEqual(Array.from({ length: 10 }, (_, i) => `song-${i}`));
  });

  // ---------------------------------------------------------------------
  // mode
  // ---------------------------------------------------------------------

  it("mode:'append' passes through to the engine", async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 3), total: 3 });

    await playStarredSongs(client as never, { mode: 'append' });

    expect(enqueueMock).toHaveBeenCalledWith(
      ['song-0', 'song-1', 'song-2'],
      'append',
      expect.any(Array),
    );
  });

  it("mode defaults to 'replace' when omitted", async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 2), total: 2 });

    await playStarredSongs(client as never, {});

    expect(enqueueMock.mock.calls[0]?.[1]).toBe('replace');
  });

  it('surfaces engine demotion in the result', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: songPage(0, 2), total: 2 });
    enqueueMock.mockResolvedValueOnce({ demoted: true });

    const result = await playStarredSongs(client as never, { mode: 'append' });

    expect(result.demoted).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Error paths
  // ---------------------------------------------------------------------

  it('throws "No starred songs" for an empty starred set', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(playStarredSongs(client as never, {})).rejects.toThrow(/No starred songs/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Schema (route-boundary parity)
  // ---------------------------------------------------------------------

  describe('PlayStarredSongsSchema', () => {
    it('defaults mode to "replace" and shuffle to false on an empty body', () => {
      const parsed = PlayStarredSongsSchema.parse({});
      expect(parsed.mode).toBe('replace');
      expect(parsed.shuffle).toBe(false);
    });

    it('accepts a fully-specified valid body', () => {
      const parsed = PlayStarredSongsSchema.parse({ mode: 'append', shuffle: true });
      expect(parsed).toEqual({ mode: 'append', shuffle: true });
    });

    it('rejects an invalid mode', () => {
      expect(PlayStarredSongsSchema.safeParse({ mode: 'nonsense' }).success).toBe(false);
    });

    it('rejects a non-boolean shuffle', () => {
      expect(PlayStarredSongsSchema.safeParse({ shuffle: 'yes' }).success).toBe(false);
    });
  });
});
