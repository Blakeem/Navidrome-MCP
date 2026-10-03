/**
 * Covers the shared album-set path behind play_albums and play_albums_search:
 * one chunked `/song` read for many albums, input album order, and the shuffle modes.
 * Also covers the queue metadata play_songs_search builds from its search rows.
 * The playback engine and the searches are mocked, so no mpv or Navidrome is touched.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

const enqueueMock = vi.fn().mockResolvedValue({ demoted: false });
const searchAlbumsMock = vi.fn();
const searchSongsMock = vi.fn();

vi.mock('../../../src/services/playback/playback-engine.js', () => ({
  playbackEngine: {
    enqueue: enqueueMock,
    ensureRunning: vi.fn().mockResolvedValue(undefined),
    isRunning: () => true,
  },
}));

vi.mock('../../../src/tools/search/index.js', () => ({
  searchAlbums: searchAlbumsMock,
  searchSongs: searchSongsMock,
}));

const { playAlbums, playAlbumsSearch, playSongsSearch } = await import('../../../src/tools/playback.js');

interface SongRecord {
  id: string;
  albumId: string;
  discNumber: number;
  trackNumber: number;
}

function albumSongs(albumId: string, count: number): SongRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${albumId}-t${index + 1}`,
    albumId,
    discNumber: 1,
    trackNumber: index + 1,
  }));
}

function enqueuedIds(): string[] {
  return enqueueMock.mock.calls[0]?.[0] as string[];
}

function requestedAlbumIds(callIndex: number): string[] {
  const endpoint = String(client.requestWithLibraryFilterAndMeta.mock.calls[callIndex]?.[0]);
  return new URLSearchParams(endpoint.split('?')[1]).getAll('album_id');
}

let client: MockNavidromeClient;

describe('album-set playback', () => {
  beforeEach(() => {
    client = createMockClient();
    enqueueMock.mockClear();
    searchAlbumsMock.mockReset();
  });

  it('reads every album in one request and restores the input album order', async () => {
    // Navidrome answers in album-name order, which differs from the requested order.
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
      data: [...albumSongs('beta', 2), ...albumSongs('alpha', 3)],
      total: 5,
    });

    const result = await playAlbums(client as never, {
      albumIds: ['alpha', 'beta'],
      mode: 'replace',
    });

    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
    expect(requestedAlbumIds(0)).toEqual(['alpha', 'beta']);
    expect(enqueuedIds()).toEqual(['alpha-t1', 'alpha-t2', 'alpha-t3', 'beta-t1', 'beta-t2']);
    expect(result).toMatchObject({ success: true, albumCount: 2, trackCount: 5 });
  });

  it('splits more than 100 albums into chunked reads', async () => {
    const albumIds = Array.from({ length: 150 }, (_, index) => `album-${index}`);
    client.requestWithLibraryFilterAndMeta
      .mockResolvedValueOnce({ data: albumSongs('album-0', 1), total: 1 })
      .mockResolvedValueOnce({ data: albumSongs('album-149', 1), total: 1 });

    await playAlbums(client as never, { albumIds, mode: 'append' });

    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(2);
    expect(requestedAlbumIds(0)).toHaveLength(100);
    expect(requestedAlbumIds(1)).toEqual(albumIds.slice(100));
  });

  it('keeps each album in track order when only the albums are shuffled', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
      data: [...albumSongs('alpha', 4), ...albumSongs('beta', 4)],
      total: 8,
    });

    await playAlbums(client as never, { albumIds: ['alpha', 'beta'], mode: 'replace', shuffleAlbums: true });

    const ids = enqueuedIds();
    const alphaFirst = ids[0]?.startsWith('alpha') === true;
    const expected = alphaFirst
      ? [...albumSongs('alpha', 4), ...albumSongs('beta', 4)]
      : [...albumSongs('beta', 4), ...albumSongs('alpha', 4)];
    expect(ids).toEqual(expected.map((song) => song.id));
  });

  it('keeps each album contiguous when the albums and the songs are both shuffled', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
      data: [...albumSongs('alpha', 4), ...albumSongs('beta', 4)],
      total: 8,
    });

    await playAlbums(client as never, {
      albumIds: ['alpha', 'beta'],
      mode: 'replace',
      shuffleAlbums: true,
      shuffleSongs: true,
    });

    const ids = enqueuedIds();
    const firstAlbum = ids[0]?.split('-')[0];
    const firstHalf = ids.slice(0, 4);
    const secondHalf = ids.slice(4);
    expect(firstHalf.every((id) => id.startsWith(`${firstAlbum}-`))).toBe(true);
    expect(secondHalf.every((id) => !id.startsWith(`${firstAlbum}-`))).toBe(true);
    expect([...ids].sort()).toEqual([...albumSongs('alpha', 4), ...albumSongs('beta', 4)].map((song) => song.id).sort());
  });

  it('rejects the old shuffle enum parameter', async () => {
    await expect(
      playAlbums(client as never, { albumIds: ['alpha'], mode: 'replace', shuffle: 'albums' }),
    ).rejects.toThrow();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('throws when the albums hold no tracks', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({ data: [], total: 0 });

    await expect(
      playAlbums(client as never, { albumIds: ['empty'], mode: 'replace' }),
    ).rejects.toThrow(/No tracks found in the active libraries for these album IDs/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('plays the matched albums of a search through the same read', async () => {
    searchAlbumsMock.mockResolvedValueOnce({
      albums: [{ id: 'alpha' }, { id: 'beta' }],
      appliedFilters: { genre: 'Rock' },
    });
    client.requestWithLibraryFilterAndMeta.mockResolvedValueOnce({
      data: [...albumSongs('beta', 1), ...albumSongs('alpha', 2)],
      total: 3,
    });

    const result = await playAlbumsSearch(client as never, { genre: 'Rock', mode: 'append' });

    expect(client.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
    expect(enqueuedIds()).toEqual(['alpha-t1', 'alpha-t2', 'beta-t1']);
    expect(result).toMatchObject({
      success: true,
      matchCount: 2,
      albumCount: 2,
      trackCount: 3,
      appliedFilters: { genre: 'Rock' },
    });
  });
});

describe('play_songs_search', () => {
  beforeEach(() => {
    client = createMockClient();
    enqueueMock.mockClear();
    searchSongsMock.mockReset();
  });

  // Empty fields stay absent so the get_play_queue and now_playing enrichment fallbacks still fire.
  it('omits empty search fields from the queue metadata and passes the filters and demotion through', async () => {
    searchSongsMock.mockResolvedValueOnce({
      songs: [{ id: 's1', title: 'T', artist: '', album: 'Al', durationFormatted: '3:05' }],
      appliedFilters: { starred: 'true' },
    });
    enqueueMock.mockResolvedValueOnce({ demoted: true });

    const result = await playSongsSearch(client as never, { starred: true });

    expect(enqueueMock).toHaveBeenCalledWith(['s1'], 'replace', [{ songId: 's1', title: 'T', album: 'Al', duration: 185 }]);
    expect(result).toEqual({ success: true, count: 1, appliedFilters: { starred: 'true' }, demoted: true });
  });

  it('rejects when no song matches and enqueues nothing', async () => {
    searchSongsMock.mockResolvedValueOnce({ songs: [] });

    await expect(playSongsSearch(client as never, { starred: true })).rejects.toThrow(/No songs matched/);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
