/**
 * Covers the get_play_queue snapshot: the Navidrome enrichment after an MCP restart,
 * mpv's title winning over Navidrome's, the LLM-facing field allow-list, and the
 * no-mpv short circuit. The playback engine is mocked, so no mpv is touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

const ensureAttachedMock = vi.fn().mockResolvedValue(undefined);
const isRunningMock = vi.fn();
const getQueueMock = vi.fn();
const ingestQueueMetadataMock = vi.fn();

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    ensureAttached: ensureAttachedMock,
    isRunning: isRunningMock,
    getQueue: getQueueMock,
    ingestQueueMetadata: ingestQueueMetadataMock,
  },
}));

const { getPlayQueue } = await import('../../../src/tools/playback.js');

function songClient(rows: unknown[]): NavidromeClient {
  return { request: vi.fn().mockResolvedValue(rows) } as unknown as NavidromeClient;
}

describe('get_play_queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isRunningMock.mockReturnValue(true);
  });

  it('fills missing metadata from Navidrome, keeps mpv title, and strips internal fields', async () => {
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 's1', entryId: 7, title: 'ICY', isCurrent: true, isPlaying: true },
      { index: 1, songId: null, isCurrent: false, isPlaying: false },
    ]);
    const client = songClient([{ id: 's1', title: 'ND', artist: 'A', album: 'B', duration: 200 }]);

    const result = await getPlayQueue(client, {});

    expect(result.items[0]).toEqual({
      index: 0,
      songId: 's1',
      title: 'ICY',
      artist: 'A',
      album: 'B',
      duration: 200,
      isCurrent: true,
      isPlaying: true,
    });
    expect(result.items[1]).toEqual({ index: 1, songId: null, isCurrent: false, isPlaying: false });
    expect(ingestQueueMetadataMock).toHaveBeenCalledTimes(1);
    expect(result.length).toBe(2);
    expect(result.currentIndex).toBe(0);
  });

  // getPlayQueue has no catch of its own, so these pin the best-effort catch in fetchSongMetadata.
  it('returns the queue without metadata when the Navidrome lookup fails', async () => {
    getQueueMock.mockResolvedValueOnce([{ index: 0, songId: 's1', isCurrent: true, isPlaying: true }]);
    const client = {
      request: vi.fn().mockRejectedValue(new Error('navidrome down')),
    } as unknown as NavidromeClient;

    const result = await getPlayQueue(client, {});

    expect(result.items[0]).toEqual({ index: 0, songId: 's1', isCurrent: true, isPlaying: true });
  });

  it('returns the queue without metadata when the Navidrome lookup is not an array', async () => {
    getQueueMock.mockResolvedValueOnce([{ index: 0, songId: 's1', isCurrent: true, isPlaying: true }]);
    const client = {
      request: vi.fn().mockResolvedValue({ error: 'unexpected' }),
    } as unknown as NavidromeClient;

    const result = await getPlayQueue(client, {});

    expect(result.items[0]).toEqual({ index: 0, songId: 's1', isCurrent: true, isPlaying: true });
  });

  it('omits currentIndex when no entry is current', async () => {
    getQueueMock.mockResolvedValueOnce([
      { index: 0, songId: 's1', title: 'T', artist: 'A', isCurrent: false, isPlaying: false },
    ]);

    const result = await getPlayQueue(songClient([]), {});

    expect(result.currentIndex).toBeUndefined();
    expect(result).not.toHaveProperty('currentIndex');
  });

  it('returns an empty queue without reading it when no mpv is running', async () => {
    isRunningMock.mockReturnValue(false);

    const result = await getPlayQueue(songClient([]), {});

    expect(result).toEqual({ items: [], length: 0 });
    expect(getQueueMock).not.toHaveBeenCalled();
  });
});
