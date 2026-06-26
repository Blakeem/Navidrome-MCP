/**
 * Navidrome MCP Server - playStarredAlbums tests
 * Copyright (C) 2025
 *
 * Covers the web-remote `play_starred_albums` impl: the exported
 * `PlayStarredAlbumsSchema`, the paginated `fetchStarredAlbumIds` helper (via
 * the impl), and the three album-aware shuffle modes / mode / empty-set paths.
 *
 * ONE mocked fn — `requestWithLibraryFilterAndMeta` — serves BOTH the `/album`
 * list page(s) AND the per-album `/song` track fetches, so the
 * `mockResolvedValueOnce` order is: album-list page(s) first, then the per-album
 * song pages in album order. The playbackEngine is mocked so no real mpv is
 * touched — end-to-end mpv behavior is covered by the playback integration
 * suite. `play-albums-pagination.test.ts` is the companion regression guard for
 * the shared `enqueueAlbumsByIds` extraction.
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

const { playStarredAlbums, PlayStarredAlbumsSchema } = await import('../../../src/tools/playback.js');

/** An `/album` list page: rows carry only the album `id` (what the helper reads). */
function albumPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({ id: `album-${start + i}` }));
}

/** A per-album `/song` page: each track row carries an `id`. */
function trackPage(albumId: string, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${albumId}-track-${i}` }));
}

/** Expected natural-order flat track list for `album-0..album-{n-1}`, each with `tracksPer`. */
function flatTracks(albumCount: number, tracksPer: number): string[] {
  const out: string[] = [];
  for (let a = 0; a < albumCount; a++) {
    for (let t = 0; t < tracksPer; t++) out.push(`album-${a}-track-${t}`);
  }
  return out;
}

describe('play_starred_albums', () => {
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

  it('requests the album list with starred=true sorted by playDate ASC', async () => {
    client.requestWithLibraryFilterAndMeta
      // album-list page
      .mockResolvedValueOnce({ data: albumPage(0, 2), total: 2 })
      // per-album song pages, in album order
      .mockResolvedValueOnce({ data: trackPage('album-0', 3), total: 3 })
      .mockResolvedValueOnce({ data: trackPage('album-1', 3), total: 3 });

    const result = await playStarredAlbums(client as never, { mode: 'replace', shuffle: 'none' });

    expect(result.success).toBe(true);
    expect(result.albumCount).toBe(2);
    expect(result.trackCount).toBe(6);

    // First call is the album list.
    const listEndpoint = client.requestWithLibraryFilterAndMeta.mock.calls[0]?.[0] as string;
    expect(listEndpoint).toContain('/album?');
    expect(listEndpoint).toContain('starred=true');
    expect(listEndpoint).toContain('_sort=playDate');
    expect(listEndpoint).toContain('_order=ASC');

    // Subsequent calls are per-album track fetches against /song.
    const trackEndpoint = client.requestWithLibraryFilterAndMeta.mock.calls[1]?.[0] as string;
    expect(trackEndpoint).toContain('/song?');
    expect(trackEndpoint).toContain('_sort=album');
  });

  it("shuffle:'none' preserves album order and natural track order", async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 3), total: 3 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 2), total: 2 })
      .mockResolvedValueOnce({ data: trackPage('album-1', 2), total: 2 })
      .mockResolvedValueOnce({ data: trackPage('album-2', 2), total: 2 });

    await playStarredAlbums(client as never, { mode: 'replace', shuffle: 'none' });

    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueued).toEqual(flatTracks(3, 2));
  });

  // ---------------------------------------------------------------------
  // Pagination of the album list
  // ---------------------------------------------------------------------

  it('paginates the album list using X-Total-Count', async () => {
    // Two album-list pages of 500 each = 1000 albums. Then one /song page per
    // album. Mock every per-album fetch with a single 1-track page via a
    // default implementation after the two list pages are consumed.
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 500), total: 1000 })
      .mockResolvedValueOnce({ data: albumPage(500, 500), total: 1000 })
      .mockResolvedValue({ data: [{ id: 'x-track-0' }], total: 1 });

    const result = await playStarredAlbums(client as never, { mode: 'replace', shuffle: 'none' });

    expect(result.success).toBe(true);
    expect(result.albumCount).toBe(1000);

    const calls = client.requestWithLibraryFilterAndMeta.mock.calls.map((c) => c[0]);
    // First two calls are the album-list pages with advancing cursor.
    expect(calls[0]).toContain('_start=0');
    expect(calls[0]).toContain('_end=500');
    expect(calls[1]).toContain('_start=500');
    expect(calls[1]).toContain('_end=1000');
    // 2 list pages + 1000 per-album fetches.
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1002);
  });

  // ---------------------------------------------------------------------
  // shuffle modes
  // ---------------------------------------------------------------------

  it("shuffle:'albums' permutes album blocks but keeps within-album order", async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 4), total: 4 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 3), total: 3 })
      .mockResolvedValueOnce({ data: trackPage('album-1', 3), total: 3 })
      .mockResolvedValueOnce({ data: trackPage('album-2', 3), total: 3 })
      .mockResolvedValueOnce({ data: trackPage('album-3', 3), total: 3 });

    await playStarredAlbums(client as never, { mode: 'replace', shuffle: 'albums' });

    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    // Same multiset as natural order.
    expect(new Set(enqueued)).toEqual(new Set(flatTracks(4, 3)));
    // Each album's three tracks remain contiguous and in natural order: every
    // track-0 is immediately followed by its track-1 then track-2.
    for (let a = 0; a < 4; a++) {
      const i = enqueued.indexOf(`album-${a}-track-0`);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(enqueued[i + 1]).toBe(`album-${a}-track-1`);
      expect(enqueued[i + 2]).toBe(`album-${a}-track-2`);
    }
  });

  it("shuffle:'songs' permutes the flat track set (same multiset)", async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 5), total: 5 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 6), total: 6 })
      .mockResolvedValueOnce({ data: trackPage('album-1', 6), total: 6 })
      .mockResolvedValueOnce({ data: trackPage('album-2', 6), total: 6 })
      .mockResolvedValueOnce({ data: trackPage('album-3', 6), total: 6 })
      .mockResolvedValueOnce({ data: trackPage('album-4', 6), total: 6 });

    await playStarredAlbums(client as never, { mode: 'replace', shuffle: 'songs' });

    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    const natural = flatTracks(5, 6);
    expect(new Set(enqueued)).toEqual(new Set(natural));
    expect(enqueued.length).toBe(natural.length);
    // 30 tracks fully shuffled — vanishingly unlikely to match natural order.
    expect(enqueued).not.toEqual(natural);
  });

  // ---------------------------------------------------------------------
  // mode
  // ---------------------------------------------------------------------

  it("mode:'append' passes through to the engine", async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 1), total: 1 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 2), total: 2 });

    await playStarredAlbums(client as never, { mode: 'append', shuffle: 'none' });

    expect(enqueueMock.mock.calls[0]?.[1]).toBe('append');
  });

  it("mode defaults to 'replace' when omitted", async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 1), total: 1 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 1), total: 1 });

    await playStarredAlbums(client as never, {});

    expect(enqueueMock.mock.calls[0]?.[1]).toBe('replace');
  });

  it('surfaces engine demotion in the result', async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumPage(0, 1), total: 1 })
      .mockResolvedValueOnce({ data: trackPage('album-0', 1), total: 1 });
    enqueueMock.mockResolvedValueOnce({ demoted: true });

    const result = await playStarredAlbums(client as never, { mode: 'append' });

    expect(result.demoted).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Error paths
  // ---------------------------------------------------------------------

  it('throws "No starred albums" for an empty starred-album set', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(playStarredAlbums(client as never, {})).rejects.toThrow(/No starred albums/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Schema (route-boundary parity)
  // ---------------------------------------------------------------------

  describe('PlayStarredAlbumsSchema', () => {
    it('defaults mode to "replace" and shuffle to "none" on an empty body', () => {
      const parsed = PlayStarredAlbumsSchema.parse({});
      expect(parsed.mode).toBe('replace');
      expect(parsed.shuffle).toBe('none');
    });

    it('accepts a fully-specified valid body', () => {
      const parsed = PlayStarredAlbumsSchema.parse({ mode: 'append', shuffle: 'songs' });
      expect(parsed).toEqual({ mode: 'append', shuffle: 'songs' });
    });

    it('rejects an invalid mode', () => {
      expect(PlayStarredAlbumsSchema.safeParse({ mode: 'nonsense' }).success).toBe(false);
    });

    it('rejects an invalid shuffle', () => {
      expect(PlayStarredAlbumsSchema.safeParse({ shuffle: 'true' }).success).toBe(false);
    });
  });
});
