/**
 * Navidrome MCP Server - library tool function tests
 * Copyright (C) 2025
 *
 * Covers getUserDetails and setActiveLibraries from src/tools/library.ts.
 * Both functions depend on the libraryManager singleton; we seed it
 * using libraryManager.initialize() with a mocked client, the same
 * pattern used in tests/unit/services/library-manager.test.ts.
 *
 * NOTE: Zod-level validation for setActiveLibraries is covered in
 * tests/unit/schemas/validation.test.ts. These tests target function-level
 * behavior: correct DTO construction, state mutation, error paths.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraryToolCategory } from '../../../src/tools/library.js';
import { libraryManager } from '../../../src/services/library-manager.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';

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
    cacheTtl: 300,
    tokenExpiry: 86400,
    features: { lastfm: false, radioBrowser: false, lyrics: false, playback: false },
    lastFmApiKey: undefined,
    radioBrowserBase: 'https://de1.api.radio-browser.info',
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

async function seedLibraryManager(mockClient: MockNavidromeClient): Promise<void> {
  const token = makeJwt({ uid: 'user-uuid-1', sub: 'tester' });
  mockClient.getCurrentToken.mockResolvedValue(token);
  mockClient.request.mockResolvedValue(makeUserInfo());

  await libraryManager.initialize(
    mockClient as unknown as NavidromeClient,
    makeConfig(),
  );
}

// ---- setup / teardown -------------------------------------------------------

let mockClient: MockNavidromeClient;

beforeEach(async () => {
  libraryManager.reset();
  mockClient = createMockClient();
  await seedLibraryManager(mockClient);
  // Reset the mock after seeding so subsequent assertions are fresh
  mockClient.request.mockReset();
});

afterEach(() => {
  libraryManager.reset();
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

  it('throws when libraryManager is not initialized', async () => {
    libraryManager.reset();
    const freshClient = createMockClient();
    const category = createLibraryToolCategory(freshClient as unknown as NavidromeClient, makeConfig());
    await expect(category.handleToolCall('get_user_details', {})).rejects.toThrow();
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

  it('activates all provided valid library IDs', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    await category.handleToolCall('set_active_libraries', { libraryIds: [1, 2] });

    expect(libraryManager.getActiveLibraryIds()).toContain(1);
    expect(libraryManager.getActiveLibraryIds()).toContain(2);
  });

  it('throws (not a {success:false} envelope) for an invalid library ID', async () => {
    const category = createLibraryToolCategory(mockClient as unknown as NavidromeClient, makeConfig());
    // ID 999 doesn't exist — setActiveLibraries now re-throws so the failure
    // surfaces as a real protocol error instead of a misleading HTTP-200 body.
    await expect(category.handleToolCall('set_active_libraries', { libraryIds: [999] }))
      .rejects.toThrow(/set_active_libraries/);
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
