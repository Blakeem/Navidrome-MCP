/**
 * Navidrome ignores `library_id` on /api/playlist, so `onlyWithPlayableTracks` probes each
 * playlist's track list, which honors it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../src/services/library-manager.js', () => ({
  libraryManager: {
    isInitialized: vi.fn(),
    getActiveLibraryIds: vi.fn(),
    getAvailableLibraries: vi.fn(),
  },
}));

import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { listPlaylists } from '../../../src/tools/playlist-management/playlist-crud.js';
import { libraryManager } from '../../../src/services/library-manager.js';

/* eslint-disable @typescript-eslint/unbound-method -- mocked vi.fn() methods never read `this` */
const mockedIsInitialized = vi.mocked(libraryManager.isInitialized);
const mockedGetActiveLibraryIds = vi.mocked(libraryManager.getActiveLibraryIds);
const mockedGetAvailableLibraries = vi.mocked(libraryManager.getAvailableLibraries);
/* eslint-enable @typescript-eslint/unbound-method -- the mock handles end here */

function rawPlaylist(id: string, songCount: number): Record<string, unknown> {
  return {
    id,
    name: `Playlist ${id}`,
    public: false,
    songCount,
    ownerName: 'tester',
  };
}

describe('listPlaylists — onlyWithPlayableTracks', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.clearAllMocks();
    mockedIsInitialized.mockReturnValue(true);
    mockedGetActiveLibraryIds.mockReturnValue([1, 2]);
    mockedGetAvailableLibraries.mockReturnValue([
      { id: 1, name: 'Lib 1', path: '/m/1' },
      { id: 2, name: 'Lib 2', path: '/m/2' },
    ] as never);
  });

  it('flag OFF → returns all playlists via a single server-paginated read, no probing', async () => {
    mockClient.requestWithMeta.mockResolvedValue({
      data: [rawPlaylist('a', 5), rawPlaylist('b', 0)],
      total: 2,
    });

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['a', 'b']);
    expect(result.total).toBe(2);

    expect(mockClient.requestWithMeta).toHaveBeenCalledTimes(1);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
    expect(mockClient.requestWithMeta).toHaveBeenCalledWith(
      expect.stringContaining('_start=0'),
    );
  });

  it('flag ON with ALL libraries active → songCount>0 filter, NO probes', async () => {
    mockedGetActiveLibraryIds.mockReturnValue([1, 2]);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [rawPlaylist('a', 5), rawPlaylist('empty', 0), rawPlaylist('c', 3)],
      total: 3,
    });

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
      onlyWithPlayableTracks: true,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
  });

  it('flag ON probes a smart playlist whose stored songCount is 0 and keeps it when the probe finds tracks', async () => {
    mockClient.requestWithMeta.mockResolvedValue({
      data: [rawPlaylist('a', 5), { ...rawPlaylist('smart', 0), rules: { all: [] } }, rawPlaylist('empty', 0)],
      total: 3,
    });
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 7 });

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
      onlyWithPlayableTracks: true,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['a', 'smart']);
    expect(result).not.toHaveProperty('truncated');
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(1);
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith(
      expect.stringContaining('/playlist/smart/tracks?_start=0&_end=1'),
    );
  });

  it('flag ON marks the result truncated when the server holds more than 500 playlists', async () => {
    mockClient.requestWithMeta.mockResolvedValue({ data: [rawPlaylist('a', 5)], total: 600 });

    const result = await listPlaylists(mockClient, { onlyWithPlayableTracks: true });

    expect(result.truncated).toBe(true);
    expect(result.total).toBe(1);
  });

  it('flag ON when libraryManager is NOT initialized → songCount>0 filter, NO probes', async () => {
    mockedIsInitialized.mockReturnValue(false);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [rawPlaylist('a', 5), rawPlaylist('empty', 0)],
      total: 2,
    });

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
      onlyWithPlayableTracks: true,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['a']);
    expect(result.total).toBe(1);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
  });

  it('flag ON with a STRICT SUBSET active → other-library-only playlists are excluded via the probe', async () => {
    mockedGetActiveLibraryIds.mockReturnValue([1]);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [
        rawPlaylist('keep', 10), // tracks in active library 1
        rawPlaylist('other', 8), // tracks only in inactive library 2
        rawPlaylist('empty', 0),
      ],
      total: 3,
    });

    mockClient.requestWithLibraryFilterAndMeta.mockImplementation(
      (endpoint: string) => {
        if (endpoint.includes('/playlist/keep/')) {
          return Promise.resolve({ data: [], total: 4 });
        }
        return Promise.resolve({ data: [], total: 0 });
      },
    );

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
      onlyWithPlayableTracks: true,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['keep']);
    expect(result.total).toBe(1);

    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(2);
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith(
      expect.stringContaining('/playlist/keep/tracks?_start=0&_end=1'),
    );
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith(
      expect.stringContaining('/playlist/other/tracks?_start=0&_end=1'),
    );
  });

  it('flag ON keeps a playlist whose probe rejects (fail-open) and still drops a probed-empty one', async () => {
    mockedGetActiveLibraryIds.mockReturnValue([1]);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [rawPlaylist('flaky', 5), rawPlaylist('other', 5)],
      total: 2,
    });
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation(
      (endpoint: string) => {
        if (endpoint.includes('/playlist/flaky/')) {
          return Promise.reject(new Error('503'));
        }
        return Promise.resolve({ data: [], total: 0 });
      },
    );

    const result = await listPlaylists(mockClient, {
      offset: 0,
      limit: 100,
      onlyWithPlayableTracks: true,
    });

    expect(result.playlists.map((p) => p.id)).toEqual(['flaky']);
  });

  it('flag ON with subset active → pagination applies over the FILTERED view', async () => {
    mockedGetActiveLibraryIds.mockReturnValue([1]);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [
        rawPlaylist('p1', 3),
        rawPlaylist('p2', 3),
        rawPlaylist('p3', 3),
      ],
      total: 3,
    });
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 2 });

    const result = await listPlaylists(mockClient, {
      offset: 1,
      limit: 1,
      onlyWithPlayableTracks: true,
    });

    expect(result.total).toBe(3);
    expect(result.playlists.map((p) => p.id)).toEqual(['p2']);
  });
});
