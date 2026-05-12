/**
 * Navidrome MCP Server - playPlaylist tests
 * Copyright (C) 2025
 *
 * Covers the one-shot `play_playlist` tool: the schema, the paginated
 * `fetchPlaylistTrackIds` helper, and the shuffle / mode / empty-playlist
 * paths. The playbackEngine is mocked so no real mpv is touched —
 * end-to-end mpv behavior is covered by the playback integration suite.
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

const { playPlaylist } = await import('../../../src/tools/playback.js');

function trackPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: start + i, // playlist-position record (numeric in Navidrome)
    mediaFileId: `song-${start + i}`,
    title: `Title ${start + i}`,
    artist: `Artist ${start + i}`,
    album: `Album ${start + i}`,
    duration: 180,
  }));
}

describe('play_playlist', () => {
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
  // Happy path
  // ---------------------------------------------------------------------

  it('enqueues a small playlist (single page) with full metadata', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 12), total: 12 });

    const result = await playPlaylist(client as never, {
      playlistId: 'pl-1',
      mode: 'replace',
      shuffle: false,
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(12);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(1);

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

  it('uses mediaFileId as the song ID (not the playlist-row id)', async () => {
    client.requestWithMeta.mockResolvedValueOnce({
      data: [
        { id: 1, mediaFileId: 'real-song-A' },
        { id: 2, mediaFileId: 'real-song-B' },
      ],
      total: 2,
    });

    await playPlaylist(client as never, { playlistId: 'pl-x' });

    const enqueuedIds = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueuedIds).toEqual(['real-song-A', 'real-song-B']);
  });

  // ---------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------

  it('paginates a 1500-track playlist using X-Total-Count', async () => {
    client.requestWithMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(500, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(1000, 500), total: 1500 });

    const result = await playPlaylist(client as never, { playlistId: 'big-pl' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1500);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(3);

    const calls = client.requestWithMeta.mock.calls.map((c) => c[0] as string);
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
    client.requestWithMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: null })
      .mockResolvedValueOnce({ data: trackPage(500, 73), total: null });

    const result = await playPlaylist(client as never, { playlistId: 'pl-no-total' });

    expect(result.success).toBe(true);
    expect(result.count).toBe(573);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(2);
  });

  it('encodes the playlist ID in the request path', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 1), total: 1 });

    await playPlaylist(client as never, { playlistId: 'has spaces/and?special' });

    const endpoint = client.requestWithMeta.mock.calls[0]?.[0] as string;
    expect(endpoint).toContain('/playlist/has%20spaces%2Fand%3Fspecial/tracks');
  });

  // ---------------------------------------------------------------------
  // shuffle
  // ---------------------------------------------------------------------

  it('shuffle:true preserves the multiset but permutes order', async () => {
    // 50 distinct tracks gives Fisher-Yates plenty of room; the chance of
    // landing on the identity permutation is 1/50! — effectively zero.
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 50), total: 50 });

    await playPlaylist(client as never, { playlistId: 'pl-shuf', shuffle: true });

    const enqueuedIds = enqueueMock.mock.calls[0]?.[0] as string[];
    const baselineIds = Array.from({ length: 50 }, (_, i) => `song-${i}`);
    expect(new Set(enqueuedIds)).toEqual(new Set(baselineIds));
    expect(enqueuedIds).not.toEqual(baselineIds);
  });

  it('shuffle:false preserves the saved playlist order', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 10), total: 10 });

    await playPlaylist(client as never, { playlistId: 'pl-keep', shuffle: false });

    const enqueuedIds = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueuedIds).toEqual(Array.from({ length: 10 }, (_, i) => `song-${i}`));
  });

  // ---------------------------------------------------------------------
  // mode
  // ---------------------------------------------------------------------

  it("mode:'append' passes through to the engine", async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 3), total: 3 });

    await playPlaylist(client as never, { playlistId: 'pl-app', mode: 'append' });

    expect(enqueueMock).toHaveBeenCalledWith(
      ['song-0', 'song-1', 'song-2'],
      'append',
      expect.any(Array),
    );
  });

  it("mode defaults to 'replace' when omitted", async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 2), total: 2 });

    await playPlaylist(client as never, { playlistId: 'pl-default' });

    expect(enqueueMock.mock.calls[0]?.[1]).toBe('replace');
  });

  it('surfaces engine demotion in the result', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 2), total: 2 });
    enqueueMock.mockResolvedValueOnce({ demoted: true });

    const result = await playPlaylist(client as never, {
      playlistId: 'pl-demote',
      mode: 'append',
    });

    expect(result.demoted).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Error paths
  // ---------------------------------------------------------------------

  it('throws "Playlist has no tracks" for an empty playlist', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(playPlaylist(client as never, { playlistId: 'pl-empty' })).rejects.toThrow(
      /Playlist has no tracks/,
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('rejects an empty playlistId at the schema layer', async () => {
    await expect(playPlaylist(client as never, { playlistId: '' })).rejects.toThrow(
      /Playlist ID is required/,
    );
    expect(client.requestWithMeta).not.toHaveBeenCalled();
  });

  it('rejects when playlistId is missing entirely', async () => {
    await expect(playPlaylist(client as never, {})).rejects.toThrow();
    expect(client.requestWithMeta).not.toHaveBeenCalled();
  });
});
