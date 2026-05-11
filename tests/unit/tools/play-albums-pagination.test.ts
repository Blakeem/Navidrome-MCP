/**
 * Navidrome MCP Server - playAlbums pagination tests
 * Copyright (C) 2025
 *
 * Covers M4 from docs/review/02-playback-deep-review.md: fetchAlbumTrackIds
 * used to hardcode a 500-track ceiling and silently truncate. The fix
 * paginates via X-Total-Count so multi-disc boxsets play through completely.
 *
 * `fetchAlbumTrackIds` is module-private; we exercise it through `playAlbums`
 * with the playbackEngine module mocked so no real mpv is touched.
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

const { playAlbums } = await import('../../../src/tools/playback.js');

function trackPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({ id: `track-${start + i}` }));
}

describe('fetchAlbumTrackIds pagination (M4)', () => {
  let client: MockNavidromeClient;

  beforeEach(() => {
    client = createMockClient();
    enqueueMock.mockClear();
    ensureRunningMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('makes a single request for an album with <= MAX_ALBUM_TRACKS tracks', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: trackPage(0, 12), total: 12 });

    const result = await playAlbums(client as never, {
      albumIds: ['album-1'],
      mode: 'replace',
      shuffle: 'none',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(12);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(1);
    // Third arg is the optional metadata array — the engine ingests it into
    // its per-session cache so `get_play_queue` reports titles for the full
    // queue, not just mpv's current track. Mock-track rows omit title/etc.
    // so each entry is just `{ songId }`.
    expect(enqueueMock).toHaveBeenCalledWith(
      Array.from({ length: 12 }, (_, i) => `track-${i}`),
      'replace',
      Array.from({ length: 12 }, (_, i) => ({ songId: `track-${i}` })),
    );
  });

  it('paginates through a 1500-track boxset using X-Total-Count', async () => {
    // Three pages: 500 + 500 + 500 = 1500 total
    client.requestWithMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(500, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(1000, 500), total: 1500 });

    const result = await playAlbums(client as never, {
      albumIds: ['boxset-1'],
      mode: 'replace',
      shuffle: 'none',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(1500);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(3);

    // Verify pagination cursor moves forward correctly
    const calls = client.requestWithMeta.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain('_start=0');
    expect(calls[0]).toContain('_end=500');
    expect(calls[1]).toContain('_start=500');
    expect(calls[1]).toContain('_end=1000');
    expect(calls[2]).toContain('_start=1000');
    expect(calls[2]).toContain('_end=1500');

    // Last enqueued track id should be the last of page 3
    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueued.at(-1)).toBe('track-1499');
    expect(enqueued.length).toBe(1500);
  });

  it('falls back to short-page heuristic when X-Total-Count is missing', async () => {
    // Server returns null total, second page is short → stop
    client.requestWithMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: null })
      .mockResolvedValueOnce({ data: trackPage(500, 87), total: null });

    const result = await playAlbums(client as never, {
      albumIds: ['album-no-total'],
      mode: 'replace',
      shuffle: 'none',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(587);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(2);
  });

  it('stops when first page returns less than a full page', async () => {
    client.requestWithMeta.mockResolvedValueOnce({
      data: trackPage(0, 250),
      total: null,
    });

    const result = await playAlbums(client as never, {
      albumIds: ['album-small'],
      mode: 'replace',
      shuffle: 'none',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(250);
    expect(client.requestWithMeta).toHaveBeenCalledTimes(1);
  });

  it('stops when total is 0 (no tracks, single request)', async () => {
    client.requestWithMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(
      playAlbums(client as never, {
        albumIds: ['empty-album'],
        mode: 'replace',
        shuffle: 'none',
      }),
    ).rejects.toThrow(/No tracks found/);

    expect(client.requestWithMeta).toHaveBeenCalledTimes(1);
  });
});
