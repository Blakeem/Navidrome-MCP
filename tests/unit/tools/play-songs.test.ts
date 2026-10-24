/**
 * Navidrome MCP Server - play_songs and play_albums input and lookup tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const enqueueMock = vi.fn().mockResolvedValue({ demoted: false, outputMissing: null });

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    enqueue: enqueueMock,
  },
}));

const { playAlbums, playSongs } = await import('../../../src/tools/playback.js');

let client: MockNavidromeClient;

beforeEach(() => {
  client = createMockClient();
  enqueueMock.mockClear();
});

describe('play_songs active-library lookup', () => {
  it('surfaces a Navidrome failure instead of reporting no playable songs', async () => {
    client.requestWithLibraryFilter.mockRejectedValueOnce(new Error('HTTP 503 Service Unavailable'));

    const call = playSongs(client as never, { songIds: ['song-1', 'song-2'] });

    await expect(call).rejects.toThrow(/^Tool 'play_songs' failed: .*HTTP 503 Service Unavailable/);
    await expect(call).rejects.not.toThrow(/No playable songs/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('rejects a non-array lookup response instead of skipping the chunk', async () => {
    client.requestWithLibraryFilter.mockResolvedValueOnce({ error: 'unexpected' });

    await expect(playSongs(client as never, { songIds: ['song-1'] })).rejects.toThrow(/expected array/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('enqueues only the IDs the scoped lookup resolved, in requested order', async () => {
    client.requestWithLibraryFilter.mockResolvedValueOnce([
      { id: 'song-3', title: 'Three' },
      { id: 'song-1', title: 'One' },
    ]);

    const result = await playSongs(client as never, { songIds: ['song-1', 'song-2', 'song-3'] });

    expect(enqueueMock.mock.calls[0]?.[0]).toEqual(['song-1', 'song-3']);
    expect(result).toEqual({ success: true, count: 2, skipped: 1 });
  });

  it('keeps success and reports paused with a message when the audio output is missing', async () => {
    client.requestWithLibraryFilter.mockResolvedValueOnce([{ id: 'song-1', title: 'One' }]);
    enqueueMock.mockResolvedValueOnce({ demoted: false, outputMissing: { id: 'wasapi/{katana}', name: null } });

    const result = await playSongs(client as never, { songIds: ['song-1'] });

    expect(result).toEqual({
      success: true,
      count: 1,
      paused: true,
      message: "The selected audio device 'wasapi/{katana}' is not connected. Turn it on, then call resume, or call set_audio_device to pick another output.",
    });
  });

  // Navidrome paginates even an id-filtered read, so each chunk must span its own length.
  it('reads more than 100 IDs in 100-ID chunks, each with _start=0 and _end=chunk length', async () => {
    const songIds = Array.from({ length: 150 }, (_, i) => `song-${i}`);
    client.requestWithLibraryFilter.mockImplementation((endpoint: string) =>
      Promise.resolve(new URLSearchParams(endpoint.split('?')[1]).getAll('id').map((id) => ({ id }))),
    );

    await playSongs(client as never, { songIds, mode: 'replace' });

    expect(client.requestWithLibraryFilter).toHaveBeenCalledTimes(2);
    const queries = client.requestWithLibraryFilter.mock.calls.map((c) => new URLSearchParams(String(c[0]).split('?')[1]));
    expect(queries[0]?.getAll('id')).toHaveLength(100);
    expect(queries[0]?.get('_start')).toBe('0');
    expect(queries[0]?.get('_end')).toBe('100');
    expect(queries[1]?.getAll('id')).toHaveLength(50);
    expect(queries[1]?.get('_start')).toBe('0');
    expect(queries[1]?.get('_end')).toBe('50');
    expect(enqueueMock.mock.calls[0]?.[0]).toEqual(songIds);
  });
});

describe('play_songs and play_albums ID validation', () => {
  it('rejects an empty album ID before any Navidrome request', async () => {
    await expect(playAlbums(client as never, { albumIds: [''] })).rejects.toThrow(/^Tool 'play_albums' failed:[\s\S]*ID is required/);
    expect(client.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
  });

  it('rejects a song ID with a path separator before any Navidrome request', async () => {
    await expect(playSongs(client as never, { songIds: ['a/b'] })).rejects.toThrow(/^Tool 'play_songs' failed:[\s\S]*invalid characters/);
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });
});
