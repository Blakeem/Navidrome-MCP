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

  it('returns empty-queue shape when server returns null', async () => {
    mockClient.request.mockResolvedValue(null);

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.trackCount).toBe(0);
    expect(result.tracks).toEqual([]);
    expect(result.current).toBe(0);
    expect(result.position).toBe(0);
    expect(result.message).toBeDefined();
    expect(typeof result.message).toBe('string');
    expect(result.queue).toBeNull();
  });

  it('returns empty-queue shape when server returns empty object', async () => {
    mockClient.request.mockResolvedValue({});

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.trackCount).toBe(0);
    expect(result.tracks).toHaveLength(0);
  });

  it('maps server items to the DTO shape', async () => {
    mockClient.request.mockResolvedValue({
      current: 1,
      position: 42000,
      updatedAt: '2026-05-10T10:00:00Z',
      items: [
        { id: 'track-1', title: 'Song A', artist: 'Artist A', album: 'Album A', duration: 240 },
        { id: 'track-2', title: 'Song B', artist: 'Artist B', album: 'Album B', duration: 180 },
      ],
    });

    const result = await getSavedQueue(mockClient as unknown as NavidromeClient, {});

    expect(result.trackCount).toBe(2);
    expect(result.current).toBe(1);
    expect(result.position).toBe(42000);
    expect(result.updatedAt).toBe('2026-05-10T10:00:00Z');
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks[0]).toHaveProperty('id');
    expect(result.tracks[0]).toHaveProperty('title');
    expect(result.tracks[0]).toHaveProperty('artist');
    expect(result.tracks[0]).toHaveProperty('album');
    expect(result.tracks[0]).toHaveProperty('duration');
    // Issue #24: surface a human-readable duration alongside raw seconds so
    // queue items match the convention used by every other song-bearing tool.
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

describe('saveQueue', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('POSTs to /queue with ids, current, position', async () => {
    mockClient.request.mockResolvedValue(undefined);

    await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['id-1', 'id-2', 'id-3'],
      current: 1,
      position: 5000,
    });

    expect(mockClient.request).toHaveBeenCalledTimes(1);
    const [endpoint, options] = mockClient.request.mock.calls[0]!;
    expect(endpoint).toBe('/queue');
    expect((options as RequestInit)?.method).toBe('POST');

    const body = JSON.parse((options as RequestInit)?.body as string);
    expect(body.ids).toEqual(['id-1', 'id-2', 'id-3']);
    expect(body.current).toBe(1);
    expect(body.position).toBe(5000);
  });

  it('returns success with correct trackCount', async () => {
    mockClient.request.mockResolvedValue(undefined);

    const result = await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['a', 'b'],
    });

    expect(result.success).toBe(true);
    expect(result.trackCount).toBe(2);
    expect(typeof result.message).toBe('string');
  });

  it('defaults current and position to 0 when omitted', async () => {
    mockClient.request.mockResolvedValue(undefined);

    await saveQueue(mockClient as unknown as NavidromeClient, {
      songIds: ['x'],
    });

    const body = JSON.parse((mockClient.request.mock.calls[0]![1] as RequestInit)?.body as string);
    expect(body.current).toBe(0);
    expect(body.position).toBe(0);
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
