/**
 * Navidrome MCP Server - library tool function tests
 * Copyright (C) 2025
 *
 * Covers getUserDetails and setActiveLibraries through the library tool category.
 * Both functions depend on the libraryManager singleton; we seed it
 * using libraryManager.initialize() with a mocked client, the same
 * pattern used in tests/unit/services/library-manager.test.ts.
 *
 * NOTE: Zod-level validation for setActiveLibraries is covered in
 * tests/unit/schemas/validation.test.ts. These tests target function-level
 * behavior: correct DTO construction, state mutation, error paths.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryToolCategory } from '../../../src/tools/handlers/library-handlers.js';
import { libraryManager } from '../../../src/services/library-manager.js';
import { filterCacheManager } from '../../../src/services/filter-cache-manager.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import type { UserDetailsDTO } from '../../../src/types/index.js';

// ---- helpers ----------------------------------------------------------------

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeUserInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    userName: 'tester',
    name: 'Tester',
    email: 'test@example.com',
    isAdmin: false,
    lastLoginAt: '2026-05-10T00:00:00Z',
    lastAccessAt: '2026-05-10T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    libraries: [
      {
        id: 1, name: 'Music', path: '/music', remotePath: '',
        lastScanAt: '2026-05-09T00:00:00Z', lastScanStartedAt: '2026-05-09T00:00:00Z',
        fullScanInProgress: false, updatedAt: '2026-05-09T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
        totalSongs: 300, totalAlbums: 30, totalArtists: 20,
        totalFolders: 10, totalFiles: 300, totalMissingFiles: 0, totalSize: 1024, totalDuration: 7200,
        defaultNewUsers: true,
      },
      {
        id: 2, name: 'Podcasts', path: '/podcasts', remotePath: '',
        lastScanAt: '0001-01-01T00:00:00Z', lastScanStartedAt: '0001-01-01T00:00:00Z',
        fullScanInProgress: false, updatedAt: '2025-01-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
        totalSongs: 50, totalAlbums: 5, totalArtists: 5,
        totalFolders: 2, totalFiles: 50, totalMissingFiles: 0, totalSize: 512, totalDuration: 3600,
        defaultNewUsers: false,
      },
    ],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://test:4533',
    navidromeUsername: 'tester',
    navidromePassword: 'pw',
    debug: false,
    tokenExpiry: 86400,
    features: { lastfm: false, radioBrowser: false, lyrics: false, playback: false },
    lastFmApiKey: undefined,
    lyricsProvider: undefined,
    lrclibUserAgent: undefined,
    lrclibBase: 'https://lrclib.net',
    playbackTranscodeFormat: 'mp3',
    playbackTranscodeBitrate: '192',
    filterCacheEnabled: true,
    defaultLibraryIds: [],
    ...overrides,
  } as Config;
}

type LibraryRow = Record<string, unknown>;

function userLibraries(): LibraryRow[] {
  return makeUserInfo()['libraries'] as LibraryRow[];
}

/** Routes /user/{uid} and /library the way Navidrome answers them. */
function routeLibraryEndpoints(
  client: MockNavidromeClient,
  options: { libraries?: LibraryRow[]; libraryStats?: () => Promise<unknown>; user?: () => Promise<unknown> } = {},
): void {
  const libraries = options.libraries ?? userLibraries();
  client.request.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/library') {
      return options.libraryStats !== undefined ? options.libraryStats() : libraries;
    }
    if (endpoint.startsWith('/user/')) {
      return options.user !== undefined ? options.user() : makeUserInfo({ libraries });
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

/** Answers the summary count reads with X-Total-Count values. */
function routeSummaryTotals(
  client: MockNavidromeClient,
  totals: { song: number | null; album: number | null; artist: number | null },
): void {
  client.requestWithLibraryFilterAndMeta.mockImplementation((endpoint: string) => {
    const resource = endpoint.slice(1, endpoint.indexOf('?')) as keyof typeof totals;
    return Promise.resolve({ data: [], total: totals[resource] });
  });
}

async function seedLibraryManager(mockClient: MockNavidromeClient): Promise<void> {
  const token = makeJwt({ uid: 'user-uuid-1', sub: 'tester' });
  mockClient.getCurrentToken.mockResolvedValue(token);
  routeLibraryEndpoints(mockClient);

  await libraryManager.initialize(
    mockClient as unknown as NavidromeClient,
    makeConfig(),
  );
}

// ---- setup / teardown -------------------------------------------------------

let mockClient: MockNavidromeClient;

beforeEach(async () => {
  libraryManager.reset();
  filterCacheManager.reset();
  mockClient = createMockClient();
  await seedLibraryManager(mockClient);
  mockClient.requestWithLibraryFilter.mockResolvedValue([]);
  await filterCacheManager.initialize(mockClient as unknown as NavidromeClient, makeConfig());
  routeSummaryTotals(mockClient, { song: 350, album: 35, artist: 22 });
  // Clear the call history after seeding so subsequent assertions are fresh
  mockClient.request.mockClear();
  mockClient.requestWithLibraryFilter.mockClear();
});

afterEach(() => {
  libraryManager.reset();
  filterCacheManager.reset();
});

// ---- getUserDetails ---------------------------------------------------------

describe('getUserDetails', () => {
  it('returns user + libraries + summary DTO shape', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as {
      user: Record<string, unknown>;
      libraries: Record<string, unknown>;
      summary: Record<string, unknown>;
    };

    expect(result).toHaveProperty('user');
    expect(result).toHaveProperty('libraries');
    expect(result).toHaveProperty('summary');

    // user fields
    expect(typeof result.user.id).toBe('string');
    expect(typeof result.user.userName).toBe('string');
    expect(typeof result.user.isAdmin).toBe('boolean');

    // libraries fields
    expect(typeof result.libraries.activeCount).toBe('number');
    expect(typeof result.libraries.totalCount).toBe('number');
    expect(Array.isArray(result.libraries.available)).toBe(true);

    // summary fields
    expect(typeof result.summary.totalSongs).toBe('number');
    expect(typeof result.summary.totalAlbums).toBe('number');
    expect(typeof result.summary.totalArtists).toBe('number');
    expect(Array.isArray(result.summary.activeLibraryNames)).toBe(true);
  });

  it('maps GO zero-time sentinel to null in scanInfo', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as {
      libraries: { available: Array<{ scanInfo: { lastScanAt: string | null } }> };
    };

    // Library id=2 has lastScanAt = '0001-01-01T00:00:00Z' which is the Go zero time
    const podcasts = result.libraries.available.find((l: Record<string, unknown>) => l['id'] === 2) as {
      scanInfo: { lastScanAt: string | null };
    } | undefined;
    expect(podcasts?.scanInfo.lastScanAt).toBeNull();
  });

  it('throws a cause-and-effect message when libraryManager is not initialized', async () => {
    libraryManager.reset();
    const freshClient = createMockClient();
    const category = createLibraryToolCategory(freshClient as unknown as NavidromeClient, makeConfig());
    await expect(category.handleToolCall('get_user_details', {}))
      .rejects.toThrow(/get_user_details.*Library selection is unavailable for this server run.*every library the account can access/);
  });

  it('reads the summary totals from X-Total-Count, so a shared artist counts once', async () => {
    routeSummaryTotals(mockClient, { song: 340, album: 33, artist: 21 });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.summary).toMatchObject({ totalSongs: 340, totalAlbums: 33, totalArtists: 21 });
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith('/artist?_start=0&_end=1');
  });

  it('falls back to the per-library sum for a total that has no X-Total-Count', async () => {
    routeSummaryTotals(mockClient, { song: 340, album: null, artist: 21 });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.summary.totalAlbums).toBe(35);
  });

  it('sums the fallback totals over the active libraries only', async () => {
    routeSummaryTotals(mockClient, { song: null, album: null, artist: null });
    libraryManager.setActiveLibraries([1]);
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.summary).toEqual({
      totalSongs: 300, totalAlbums: 30, totalArtists: 20, activeLibraryNames: ['Music'],
    });
    expect(result.libraries.activeCount).toBe(1);
    expect(result.libraries.totalCount).toBe(2);
  });

  it('names the per-library counts with the total prefix the summary uses', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.libraries.available.find(lib => lib.id === 1)?.stats).toEqual({
      totalSongs: 300, totalAlbums: 30, totalArtists: 20, totalSize: 1024, totalDuration: 7200,
    });
  });

  it('reports stats and scanInfo as null when the /library stats read fails', async () => {
    routeLibraryEndpoints(mockClient, { libraryStats: () => Promise.reject(new Error('HTTP 403 Forbidden')) });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    for (const library of result.libraries.available) {
      expect(library.stats).toBeNull();
      expect(library.scanInfo).toBeNull();
    }
  });

  it('reloads the library list, so a library added after startup is listed and inactive', async () => {
    const added = { ...userLibraries()[0], id: 3, name: 'Audiobooks', path: '/audiobooks' };
    routeLibraryEndpoints(mockClient, { libraries: [...userLibraries(), added] });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.libraries.totalCount).toBe(3);
    expect(result.libraries.available.find(lib => lib.id === 3)?.isActive).toBe(false);
    expect(libraryManager.getActiveLibraryIds()).toEqual([1, 2]);
  });

  it('keeps the previous snapshot when the reload fails', async () => {
    routeLibraryEndpoints(mockClient, { user: () => Promise.reject(new Error('HTTP 503')) });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('get_user_details', {}) as UserDetailsDTO;

    expect(result.libraries.available.map(lib => lib.id)).toEqual([1, 2]);
    expect(result.libraries.available[0]?.stats).not.toBeNull();
  });

  it('drops an active library that the reload no longer lists', async () => {
    routeLibraryEndpoints(mockClient, { libraries: [userLibraries()[0] as LibraryRow] });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await category.handleToolCall('get_user_details', {});

    expect(libraryManager.getActiveLibraryIds()).toEqual([1]);
  });
});

// ---- setActiveLibraries -----------------------------------------------------

describe('setActiveLibraries', () => {
  it('sets active libraries and returns success + activeLibraries list', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('set_active_libraries', { libraryIds: [1] }) as {
      success: boolean;
      activeLibraries: Array<{ id: number; name: string }>;
      totalCount: number;
      message: string;
    };

    expect(result.success).toBe(true);
    expect(Array.isArray(result.activeLibraries)).toBe(true);
    expect(result.activeLibraries).toHaveLength(1);
    expect(result.activeLibraries[0]).toHaveProperty('id');
    expect(result.activeLibraries[0]).toHaveProperty('name');
    expect(typeof result.totalCount).toBe('number');
    expect(typeof result.message).toBe('string');

    // Verify the singleton state was actually updated
    expect(libraryManager.getActiveLibraryIds()).toEqual([1]);
  });

  it('reloads the filter cache so tag filters resolve against the new libraries', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await category.handleToolCall('set_active_libraries', { libraryIds: [2] });

    expect(mockClient.requestWithLibraryFilter).toHaveBeenCalledWith(expect.stringContaining('/tag?tag_name=genre'));
    expect(mockClient.requestWithLibraryFilter).toHaveBeenCalledWith(expect.stringContaining('/tag?tag_name=mood'));
  });

  it('activates all provided valid library IDs', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await category.handleToolCall('set_active_libraries', { libraryIds: [1, 2] });

    expect(libraryManager.getActiveLibraryIds()).toContain(1);
    expect(libraryManager.getActiveLibraryIds()).toContain(2);
  });

  it('throws (not a {success:false} envelope) for an invalid library ID', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    // A thrown failure surfaces as a protocol error instead of a misleading HTTP-200 body.
    await expect(category.handleToolCall('set_active_libraries', { libraryIds: [999] }))
      .rejects.toThrow(/set_active_libraries.*Library IDs not available to this user: 999\. Available: 1, 2\. Call get_user_details/);
  });

  it('rejects mixed valid and unknown IDs and leaves the selection unchanged', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await category.handleToolCall('set_active_libraries', { libraryIds: [2] });

    await expect(category.handleToolCall('set_active_libraries', { libraryIds: [1, 99] }))
      .rejects.toThrow(/Library IDs not available to this user: 99\./);
    expect(libraryManager.getActiveLibraryIds()).toEqual([2]);
  });

  it('reloads the library list once before rejecting an unknown ID', async () => {
    const added = { ...userLibraries()[0], id: 3, name: 'Audiobooks', path: '/audiobooks' };
    routeLibraryEndpoints(mockClient, { libraries: [...userLibraries(), added] });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    const result = await category.handleToolCall('set_active_libraries', { libraryIds: [3] }) as {
      activeLibraries: Array<{ id: number; name: string }>;
    };

    expect(result.activeLibraries).toEqual([{ id: 3, name: 'Audiobooks' }]);
    expect(libraryManager.getActiveLibraryIds()).toEqual([3]);
  });

  it('throws a cause-and-effect message when libraryManager is not initialized', async () => {
    libraryManager.reset();
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await expect(category.handleToolCall('set_active_libraries', { libraryIds: [1] }))
      .rejects.toThrow(/set_active_libraries.*Library selection is unavailable for this server run/);
  });

  it('throws when non-integer library IDs fail Zod validation', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    // The Zod schema requires an array of integers; 'abc' should be rejected,
    // and the ZodError is re-thrown (formatted) rather than swallowed.
    await expect(category.handleToolCall('set_active_libraries', { libraryIds: ['abc'] }))
      .rejects.toThrow(/set_active_libraries/);
  });

  it('throws when the libraryIds array is empty', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await expect(category.handleToolCall('set_active_libraries', { libraryIds: [] }))
      .rejects.toThrow(/set_active_libraries/);
  });
});

// ---- get_artist description -------------------------------------------------

describe('get_artist description', () => {
  function getArtistDescription(lastfm: boolean): string {
    const config = makeConfig({ features: { lastfm, radioBrowser: false, lyrics: false, playback: false } });
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, config);
    return category.tools.find(tool => tool.name === 'get_artist')?.description ?? '';
  }

  it('names no Last.fm tool when Last.fm is not configured', () => {
    expect(getArtistDescription(false)).not.toMatch(/get_artist_info/);
  });

  it('points to the Last.fm tools when Last.fm is configured', () => {
    expect(getArtistDescription(true)).toMatch(/get_artist_info, get_similar_artists, get_top_tracks_by_artist/);
  });
});
