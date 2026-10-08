/**
 * Navidrome MCP Server - playLibrarySource tests
 * Copyright (C) 2025
 *
 * The playbackEngine is mocked so no real mpv is touched. End-to-end mpv
 * behavior is covered by the playback integration suite.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const enqueueMock = vi.fn().mockResolvedValue({ demoted: false });

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    enqueue: enqueueMock,
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    isRunning: () => true,
  },
}));

vi.mock('../../../src/tools/queue-order.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/queue-order.js')>();
  return { ...actual, orderQueueSongs: vi.fn(actual.orderQueueSongs) };
});

const { EmptyLibrarySourceError, playLibrarySource } = await import('../../../src/tools/playback.js');
const { orderQueueSongs } = await import('../../../src/tools/queue-order.js');

interface SongRowOptions {
  albumId?: string;
  discNumber?: number;
  trackNumber?: number;
}

function songRow(id: string, options: SongRowOptions = {}): Record<string, unknown> {
  return { id, title: `Title ${id}`, artist: 'Artist', album: 'Album', duration: 200, ...options };
}

function songPage(start: number, count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => songRow(`song-${start + i}`));
}

function endpointAt(client: MockNavidromeClient, index: number): string {
  return client.requestWithLibraryFilterAndMeta.mock.calls[index]?.[0] as string;
}

function endpointParams(endpoint: string): URLSearchParams {
  return new URL(endpoint, 'http://localhost').searchParams;
}

function enqueuedIds(): unknown {
  return enqueueMock.mock.calls[0]?.[0];
}

describe('playLibrarySource', () => {
  let client: MockNavidromeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    enqueueMock.mockResolvedValue({ demoted: false });
    client = createMockClient();
  });

  describe('source requests', () => {
    it('reads one song by id', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('so1')], total: 1 });

      const result = await playLibrarySource(client as never, { type: 'song', id: 'so1', mode: 'append' });

      const endpoint = endpointAt(client, 0);
      expect(endpoint).toContain('/song?');
      expect(endpoint).toContain('id=so1');
      expect(result).toEqual({ success: true, count: 1 });
      expect(enqueueMock).toHaveBeenCalledWith(['so1'], 'append', expect.any(Array));
    });

    it('reads an album in album order', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });

      await playLibrarySource(client as never, { type: 'album', id: 'al1', mode: 'replace' });

      const endpoint = endpointAt(client, 0);
      expect(endpoint).toContain('/song?');
      expect(endpoint).toContain('album_id=al1');
      expect(endpoint).toContain('_sort=album');
      expect(endpoint).toContain('_order=ASC');
    });

    it('reads an artist through artists_id in album order', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });

      await playLibrarySource(client as never, { type: 'artist', id: 'ar-1_x', mode: 'replace' });

      const params = endpointParams(endpointAt(client, 0));
      expect(endpointAt(client, 0)).toContain('/song?');
      expect(params.get('artists_id')).toBe('ar-1_x');
      expect(params.get('artist_id')).toBeNull();
      expect(params.get('_sort')).toBe('album');
      expect(params.get('_order')).toBe('ASC');
      expect(params.get('_start')).toBe('0');
      expect(params.get('_end')).toBe('500');
    });

    it('reads a playlist in playlist order', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
        data: [
          { id: 1, mediaFileId: 'm2', title: 'Two' },
          { id: 2, mediaFileId: 'm1', title: 'One' },
        ],
        total: 2,
      });

      await playLibrarySource(client as never, { type: 'playlist', id: 'pl1', mode: 'replace' });

      expect(endpointAt(client, 0)).toContain('/playlist/pl1/tracks?');
      expect(enqueuedIds()).toEqual(['m2', 'm1']);
    });

    it('reads starred songs least recently played first', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });

      await playLibrarySource(client as never, { type: 'starred-songs', mode: 'replace' });

      const endpoint = endpointAt(client, 0);
      expect(endpoint).toContain('/song?');
      expect(endpoint).toContain('starred=true');
      expect(endpoint).toContain('_sort=playDate');
      expect(endpoint).toContain('_order=ASC');
    });

    it('reads starred albums, then their songs with a repeated album_id key', async () => {
      client.requestWithLibraryFilterAndMeta
        .mockResolvedValueOnce({ data: [{ id: 'al1' }, { id: 'al2' }], total: 2 })
        .mockResolvedValueOnce({ data: [songRow('s1', { albumId: 'al1' })], total: 1 });

      await playLibrarySource(client as never, { type: 'starred-albums', mode: 'replace' });

      const albumEndpoint = endpointAt(client, 0);
      expect(albumEndpoint).toContain('/album?');
      expect(albumEndpoint).toContain('starred=true');
      expect(albumEndpoint).toContain('_sort=playDate');
      const songEndpoint = endpointAt(client, 1);
      expect(songEndpoint).toContain('/song?');
      expect(songEndpoint).toContain('_sort=album');
      expect(endpointParams(songEndpoint).getAll('album_id')).toEqual(['al1', 'al2']);
    });
  });

  describe('starred albums', () => {
    it('reads 150 starred albums in two song reads of 100 and 50 album ids', async () => {
      const albums = Array.from({ length: 150 }, (_, i) => ({ id: `al${i}` }));
      client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
        if (endpoint.startsWith('/album?')) return Promise.resolve({ data: albums, total: albums.length });
        const albumIds = endpointParams(endpoint).getAll('album_id');
        const songs = albumIds.map((albumId) => songRow(`s-${albumId}`, { albumId }));
        return Promise.resolve({ data: songs, total: songs.length });
      });

      const result = await playLibrarySource(client as never, { type: 'starred-albums', mode: 'replace' });

      const songEndpoints = client.requestWithLibraryFilterAndMeta.mock.calls
        .map((call) => call[0])
        .filter((endpoint) => endpoint.startsWith('/song?'));
      expect(songEndpoints).toHaveLength(2);
      expect(endpointParams(songEndpoints[0] ?? '').getAll('album_id')).toHaveLength(100);
      expect(endpointParams(songEndpoints[1] ?? '').getAll('album_id')).toHaveLength(50);
      expect(endpointParams(songEndpoints[1] ?? '').getAll('album_id')[0]).toBe('al100');
      expect(result).toEqual({ success: true, count: 150 });
    });

    it('regroups album-name ordered rows into starred album order', async () => {
      client.requestWithLibraryFilterAndMeta
        .mockResolvedValueOnce({ data: [{ id: 'zz' }, { id: 'aa' }], total: 2 })
        .mockResolvedValueOnce({
          data: [
            songRow('aa-1', { albumId: 'aa', trackNumber: 1 }),
            songRow('aa-2', { albumId: 'aa', trackNumber: 2 }),
            songRow('zz-1', { albumId: 'zz', trackNumber: 1 }),
            songRow('zz-2', { albumId: 'zz', trackNumber: 2 }),
          ],
          total: 4,
        });

      await playLibrarySource(client as never, { type: 'starred-albums', mode: 'replace' });

      expect(enqueuedIds()).toEqual(['zz-1', 'zz-2', 'aa-1', 'aa-2']);
    });
  });

  describe('empty sources', () => {
    it.each([
      ['song', { type: 'song', id: 'so1' }, /Song not found in the active libraries/],
      ['album', { type: 'album', id: 'al1' }, /Album has no songs/],
      ['artist', { type: 'artist', id: 'ar1' }, /Artist has no songs/],
      ['playlist', { type: 'playlist', id: 'pl1' }, /Playlist has no tracks/],
      ['starred-songs', { type: 'starred-songs' }, /No starred songs/],
      ['starred-albums', { type: 'starred-albums' }, /No songs in starred albums/],
    ] as const)('throws EmptyLibrarySourceError for an empty %s source', async (_label, source, message) => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

      const play = playLibrarySource(client as never, { ...source, mode: 'replace' });
      await expect(play).rejects.toBeInstanceOf(EmptyLibrarySourceError);
      await expect(play).rejects.toThrow(message);
      expect(enqueueMock).not.toHaveBeenCalled();
    });
  });

  describe('ordering and enqueue', () => {
    it('passes both shuffle flags to the ordering', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });

      await playLibrarySource(client as never, {
        type: 'album',
        id: 'al1',
        mode: 'replace',
        shuffleSongs: true,
        shuffleAlbums: false,
      });

      expect(vi.mocked(orderQueueSongs)).toHaveBeenCalledWith(expect.any(Array), {
        shuffleSongs: true,
        shuffleAlbums: false,
      });
    });

    it('defaults both shuffle flags to false', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });

      await playLibrarySource(client as never, { type: 'starred-songs', mode: 'append' });

      expect(vi.mocked(orderQueueSongs)).toHaveBeenCalledWith(expect.any(Array), {
        shuffleSongs: false,
        shuffleAlbums: false,
      });
    });

    it('enqueues the ordered ids so album shuffle sorts each album by disc and track', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
        data: [
          { ...songRow('1', { albumId: 'al1', discNumber: 1, trackNumber: 2 }), mediaFileId: 't2' },
          { ...songRow('2', { albumId: 'al1', discNumber: 1, trackNumber: 1 }), mediaFileId: 't1' },
        ],
        total: 2,
      });

      await playLibrarySource(client as never, {
        type: 'playlist',
        id: 'pl1',
        mode: 'replace',
        shuffleAlbums: true,
      });

      expect(enqueuedIds()).toEqual(['t1', 't2']);
    });

    it('hands the engine only queue metadata fields', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
        data: [songRow('s1', { albumId: 'al1', discNumber: 1, trackNumber: 3 })],
        total: 1,
      });

      await playLibrarySource(client as never, { type: 'album', id: 'al1', mode: 'replace' });

      expect(enqueueMock).toHaveBeenCalledWith(['s1'], 'replace', [
        { songId: 's1', title: 'Title s1', artist: 'Artist', album: 'Album', duration: 200 },
      ]);
    });

    it('follows a second page and enqueues every id in order with the mode', async () => {
      client.requestWithLibraryFilterAndMeta
        .mockResolvedValueOnce({ data: songPage(0, 500), total: 520 })
        .mockResolvedValueOnce({ data: songPage(500, 20), total: 520 });

      const result = await playLibrarySource(client as never, { type: 'artist', id: 'ar1', mode: 'append' });

      expect(result).toEqual({ success: true, count: 520 });
      const secondParams = endpointParams(endpointAt(client, 1));
      expect(secondParams.get('_start')).toBe('500');
      expect(secondParams.get('_end')).toBe('1000');
      const expectedIds = Array.from({ length: 520 }, (_, i) => `song-${i}`);
      expect(enqueueMock).toHaveBeenCalledWith(expectedIds, 'append', expect.any(Array));
    });

    it('reports a demoted append', async () => {
      client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [songRow('s1')], total: 1 });
      enqueueMock.mockResolvedValueOnce({ demoted: true });

      const result = await playLibrarySource(client as never, { type: 'song', id: 's1', mode: 'append' });

      expect(result).toEqual({ success: true, count: 1, demoted: true });
    });
  });

  describe('input validation', () => {
    it('rejects an id with invalid characters before any request', async () => {
      await expect(
        playLibrarySource(client as never, { type: 'artist', id: 'ar1/../x', mode: 'replace' }),
      ).rejects.toThrow(/ID contains invalid characters/);
      expect(client.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
      expect(enqueueMock).not.toHaveBeenCalled();
    });

    it('rejects an id type without an id before any request', async () => {
      await expect(playLibrarySource(client as never, { type: 'playlist', mode: 'replace' })).rejects.toThrow(
        /ID is required/,
      );
      expect(client.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
    });
  });
});
