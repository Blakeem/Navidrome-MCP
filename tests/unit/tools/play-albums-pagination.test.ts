/**
 * Navidrome MCP Server - playAlbums pagination tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A boxset can exceed one QUEUE_READ_PAGE_SIZE page, so the album track read must page by
 * X-Total-Count. The private read is reached through playAlbums with the playback engine mocked.
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
  },
}));

const { playAlbums } = await import('../../../src/tools/playback.js');

function trackPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({ id: `track-${start + i}` }));
}

describe('playAlbums album track pagination', () => {
  let client: MockNavidromeClient;

  beforeEach(() => {
    client = createMockClient();
    enqueueMock.mockClear();
    ensureRunningMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('makes a single request for an album with <= QUEUE_READ_PAGE_SIZE tracks', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: trackPage(0, 12), total: 12 });

    const result = await playAlbums(client as never, {
      albumIds: ['album-1'],
      mode: 'replace',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(12);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
    // The third argument is the metadata the engine caches for get_play_queue. These mock rows
    // carry only an id, so each metadata entry holds only songId.
    expect(enqueueMock).toHaveBeenCalledWith(
      Array.from({ length: 12 }, (_, i) => `track-${i}`),
      'replace',
      Array.from({ length: 12 }, (_, i) => ({ songId: `track-${i}` })),
    );
  });

  it('paginates through a 1500-track boxset using X-Total-Count', async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(500, 500), total: 1500 })
      .mockResolvedValueOnce({ data: trackPage(1000, 500), total: 1500 });

    const result = await playAlbums(client as never, {
      albumIds: ['boxset-1'],
      mode: 'replace',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(1500);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(3);

    const calls = client.requestWithLibraryFilterAndMeta.mock.calls.map((c) => c[0]);
    expect(calls[0]).toContain('_start=0');
    expect(calls[0]).toContain('_end=500');
    expect(calls[1]).toContain('_start=500');
    expect(calls[1]).toContain('_end=1000');
    expect(calls[2]).toContain('_start=1000');
    expect(calls[2]).toContain('_end=1500');

    const enqueued = enqueueMock.mock.calls[0]?.[0] as string[];
    expect(enqueued.at(-1)).toBe('track-1499');
    expect(enqueued.length).toBe(1500);
  });

  it('falls back to short-page heuristic when X-Total-Count is missing', async () => {
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: trackPage(0, 500), total: null })
      .mockResolvedValueOnce({ data: trackPage(500, 87), total: null });

    const result = await playAlbums(client as never, {
      albumIds: ['album-no-total'],
      mode: 'replace',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(587);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(2);
  });

  it('stops when first page returns less than a full page', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
      data: trackPage(0, 250),
      total: null,
    });

    const result = await playAlbums(client as never, {
      albumIds: ['album-small'],
      mode: 'replace',
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(250);
    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
  });

  it('stops when total is 0 (no tracks, single request)', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(
      playAlbums(client as never, {
        albumIds: ['empty-album'],
        mode: 'replace',
      }),
    ).rejects.toThrow(/No tracks found/);

    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
  });
});
