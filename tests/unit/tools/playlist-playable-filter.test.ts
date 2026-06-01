/**
 * Unit Tests for `listPlaylists` playable-playlist filtering
 * (`onlyWithPlayableTracks`).
 *
 * Because Navidrome IGNORES `/api/playlist?library_id=X`, the playlist LIST
 * cannot be server-side library-filtered. The flag instead probes each
 * candidate playlist's tracks (which DO honor `library_id`) to decide whether
 * it has >=1 playable track in the currently active libraries.
 *
 * These are pure mocked-client + mocked-libraryManager tests — no live server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the library-manager singleton so we can drive the active/available
// library state deterministically. Must be hoisted before the SUT import.
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

// Typed handles to the mocked singleton methods.
/* eslint-disable @typescript-eslint/unbound-method -- vitest mock handles; the mocked singleton methods are vi.fn()s with no `this` usage */
const mockedIsInitialized = vi.mocked(libraryManager.isInitialized);
const mockedGetActiveLibraryIds = vi.mocked(libraryManager.getActiveLibraryIds);
const mockedGetAvailableLibraries = vi.mocked(libraryManager.getAvailableLibraries);
/* eslint-enable @typescript-eslint/unbound-method -- restore the rule after the mock handles above */

// Minimal raw playlist rows (the shape `/api/playlist` returns, pre-transform).
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
    // Sensible defaults; individual tests override as needed.
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
      // onlyWithPlayableTracks omitted → default false
    });

    // Empty playlists are NOT dropped in the default management view.
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['a', 'b']);
    expect(result.total).toBe(2);

    // Single list read; no per-playlist probes.
    expect(mockClient.requestWithMeta).toHaveBeenCalledTimes(1);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
    // The list read honored the LLM's offset/limit window directly.
    expect(mockClient.requestWithMeta).toHaveBeenCalledWith(
      expect.stringContaining('_start=0'),
    );
  });

  it('flag ON with ALL libraries active → songCount>0 filter, NO probes', async () => {
    // All available libraries active → probing would be redundant.
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

    // Empty playlist dropped; non-empty kept. No probes fired.
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
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

    expect(result.playlists.map((p) => p.playlistId)).toEqual(['a']);
    expect(result.total).toBe(1);
    expect(mockClient.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
  });

  it('flag ON with a STRICT SUBSET active → other-library-only playlists are excluded via the probe', async () => {
    // Only library 1 is active out of {1,2} → must probe.
    mockedGetActiveLibraryIds.mockReturnValue([1]);

    mockClient.requestWithMeta.mockResolvedValue({
      data: [
        rawPlaylist('keep', 10), // has tracks in active lib 1
        rawPlaylist('other', 8), // tracks only in deactivated lib 2
        rawPlaylist('empty', 0), // empty → dropped without a probe
      ],
      total: 3,
    });

    // Probe results: filtered X-Total-Count per playlist. 'keep' has 4 tracks
    // in the active library; 'other' has 0.
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

    expect(result.playlists.map((p) => p.playlistId)).toEqual(['keep']);
    expect(result.total).toBe(1);

    // Only the two NON-empty playlists were probed (empty one skipped).
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledTimes(2);
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith(
      expect.stringContaining('/playlist/keep/tracks?_start=0&_end=1'),
    );
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith(
      expect.stringContaining('/playlist/other/tracks?_start=0&_end=1'),
    );
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
    // All three are playable in the active library.
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 2 });

    const result = await listPlaylists(mockClient, {
      offset: 1,
      limit: 1,
      onlyWithPlayableTracks: true,
    });

    // total reflects the full FILTERED count (3), the page is offset/limit of it.
    expect(result.total).toBe(3);
    expect(result.playlists.map((p) => p.playlistId)).toEqual(['p2']);
  });
});
