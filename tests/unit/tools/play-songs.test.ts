/**
 * Navidrome MCP Server - play_songs and play_albums input and lookup tests
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const enqueueMock = vi.fn().mockResolvedValue({ demoted: false });

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
