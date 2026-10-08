/**
 * Navidrome MCP Server - queue-management tests
 * Copyright (C) 2025
 *
 * Covers getSavedQueue, saveQueue, clearSavedQueue.
 * All three touch the Navidrome /queue endpoint (server-side state) so
 * every test uses createMockClient() — no live calls.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getSavedQueue, saveQueue, clearSavedQueue } from '../../../src/tools/queue-management.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

describe('getSavedQueue', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  const EMPTY_QUEUE = { currentIndex: 0, position: 0, trackCount: 0, tracks: [], updatedAt: null };

  it('returns the empty-queue shape when server returns null', async () => {
    mockClient.request.mockResolvedValue(null);

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result).toEqual(EMPTY_QUEUE);
  });

  it('returns the empty-queue shape when server returns empty object', async () => {
    mockClient.request.mockResolvedValue({});

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result).toEqual(EMPTY_QUEUE);
  });

  it('returns the same empty-queue shape for the zero-valued record a live server sends', async () => {
    mockClient.request.mockResolvedValue({
      id: '',
      userId: 'user-1',
      current: 0,
      position: 0,
      changedBy: '',
      createdAt: '0001-01-01T00:00:00Z',
      updatedAt: '0001-01-01T00:00:00Z',
    });

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result).toEqual(EMPTY_QUEUE);
  });

  it('maps server items to the DTO shape', async () => {
    mockClient.request.mockResolvedValue({
      current: 1,
      position: 42000,
      updatedAt: '2026-05-10T10:00:00Z',
      items: [
        { id: 'track-1', title: 'Song A', artist: 'Artist A', artistId: 'artist-a', album: 'Album A', albumId: 'album-a', duration: 240 },
        { id: 'track-2', title: 'Song B', artist: 'Artist B', artistId: 'artist-b', album: 'Album B', albumId: 'album-b', duration: 180 },
      ],
    });

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.trackCount).toBe(2);
    expect(result.currentIndex).toBe(1);
    // Navidrome stores milliseconds. The tool reports seconds, the unit now_playing uses.
    expect(result.position).toBe(42);
    expect(result).not.toHaveProperty('current');
    expect(result.updatedAt).toBe('2026-05-10T10:00:00Z');
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toHaveProperty('id');
    expect(result.tracks[0]).toHaveProperty('title');
    expect(result.tracks[0]).toHaveProperty('artist');
    expect(result.tracks[0]).toHaveProperty('album');
    // Queue items use the compact song DTO, which carries lookup ids and no raw duration.
    expect(result.tracks[0]).toMatchObject({ artistId: 'artist-a', albumId: 'album-a' });
    expect(result.tracks[0]).not.toHaveProperty('duration');
    expect(result.tracks[0]).toHaveProperty('durationFormatted');
    expect(result.tracks[0]?.durationFormatted).toBe('4:00');
    expect(result.tracks[1]?.durationFormatted).toBe('3:00');
  });

  it('requests GET /queue', async () => {
    mockClient.request.mockResolvedValue(null);

    await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    const [endpoint] = mockClient.request.mock.calls[0]!;
    expect(endpoint).toBe('/queue');
  });

  it('emits updatedAt: null when server returns empty/null updatedAt', async () => {
    // Issue #33: the prior shape `omitted` updatedAt in this case, which
    // forced the LLM to infer "field exists but is empty" — null is the
    // clearer signal for a never-saved/just-cleared queue.
    mockClient.request.mockResolvedValue({
      current: 0,
      position: 0,
      updatedAt: '',
      items: [],
    });

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.updatedAt).toBeNull();
  });

  it('maps Go zero-time updatedAt to null (issue #33)', async () => {
    mockClient.request.mockResolvedValue({
      current: 0,
      position: 0,
      // The exact sentinel Navidrome returns when the queue was cleared or
      // never saved (Go's time.Time zero value in RFC 3339 form).
      updatedAt: '0001-01-01T00:00:00Z',
      items: [],
    });

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.updatedAt).toBeNull();
  });

  it('emits updatedAt: null on the empty-response path', async () => {
    mockClient.request.mockResolvedValue(null);

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.updatedAt).toBeNull();
  });
});

/** Answers the song-ID check with a row per known ID, and every other request with undefined. */
function answerSongLookups(mockClient: MockNavidromeClient, unknownIds: readonly string[] = []): void {
  mockClient.request.mockImplementation((endpoint: string) => {
    if (!endpoint.startsWith('/song?')) return Promise.resolve(undefined);
    const ids = new URLSearchParams(endpoint.slice('/song?'.length)).getAll('id');
    return Promise.resolve(ids.filter((id) => !unknownIds.includes(id)).map((id) => ({ id, title: id })));
  });
}

function queuePostBody(mockClient: MockNavidromeClient): { ids: string[]; current: number; position: number } {
  const call = mockClient.request.mock.calls.find(([endpoint]) => endpoint === '/queue');
  if (call === undefined) throw new Error('no POST /queue call');
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('saveQueue', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('POSTs to /queue with ids, current, and the position converted to milliseconds', async () => {
    answerSongLookups(mockClient);

    await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['id-1', 'id-2', 'id-3'],
      currentIndex: 1,
      position: 5,
    });

    const post = mockClient.request.mock.calls.find(([endpoint]) => endpoint === '/queue');
    expect(post?.[1]?.method).toBe('POST');

    const body = queuePostBody(mockClient);
    expect(body.ids).toEqual(['id-1', 'id-2', 'id-3']);
    expect(body.current).toBe(1);
    expect(body.position).toBe(5000);
  });

  it('accepts a fractional now_playing position and rounds it to whole milliseconds', async () => {
    answerSongLookups(mockClient);

    await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['id-1'],
      position: 12.3456,
    });

    expect(queuePostBody(mockClient).position).toBe(12346);
  });

  it('rejects a currentIndex past the end of songIds', async () => {
    await expect(
      saveQueue(mockClient as unknown as NavidromeClient, { songIds: ['a', 'b'], currentIndex: 2 })
    ).rejects.toThrow(/currentIndex: currentIndex must be less than songIds\.length \(2\)/);
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it('rejects a negative position', async () => {
    await expect(
      saveQueue(mockClient as unknown as NavidromeClient, { songIds: ['a'], position: -1 })
    ).rejects.toThrow(/position: /);
    expect(mockClient.request).not.toHaveBeenCalled();
  });

  it('returns success with correct trackCount', async () => {
    answerSongLookups(mockClient);

    const result = await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['a', 'b'],
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(2);
    expect(typeof result.message).toBe('string');
  });

  it('defaults currentIndex and position to 0 when omitted', async () => {
    answerSongLookups(mockClient);

    await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['x'],
    });

    const body = queuePostBody(mockClient);
    expect(body.current).toBe(0);
    expect(body.position).toBe(0);
  });

  it('rejects an unknown song ID without saving, since Navidrome would drop it and shift currentIndex', async () => {
    answerSongLookups(mockClient, ['gone']);

    await expect(
      saveQueue(mockClient as unknown as NavidromeClient, { songIds: ['gone', 'a', 'b'], currentIndex: 1 }),
    ).rejects.toThrow("Tool 'save_queue' failed: Unknown song IDs: gone. The saved queue was not changed.");
    expect(mockClient.request.mock.calls.some(([endpoint]) => endpoint === '/queue')).toBe(false);
  });

  it('rejects when songIds is missing (Zod validation)', async () => {
    await expect(
      saveQueue(mockClient as unknown as NavidromeClient, {})
    ).rejects.toThrow();
  });
});

describe('clearSavedQueue', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('sends DELETE /queue', async () => {
    mockClient.request.mockResolvedValue(undefined);

    await clearSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    const [endpoint, options] = mockClient.request.mock.calls[0]!;
    expect(endpoint).toBe('/queue');
    expect((options as RequestInit)?.method).toBe('DELETE');
  });

  it('returns success: true and a message', async () => {
    mockClient.request.mockResolvedValue(undefined);

    const result = await clearSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
  });
});
