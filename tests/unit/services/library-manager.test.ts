/**
 * Navidrome MCP Server - LibraryManager unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * A malformed JWT must not crash startup. It leaves the manager uninitialized, so library scoping
 * is off for the session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryManager } from '../../../src/services/library-manager.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

/** A representative `/api/user/{uid}` response shape. */
function makeUserInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    userName: 'tester',
    name: 'Tester',
    email: 't@example.com',
    isAdmin: false,
    lastLoginAt: '2026-05-10T00:00:00Z',
    lastAccessAt: '2026-05-10T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-05-10T00:00:00Z',
    libraries: [
      { id: 1, name: 'Music', path: '/music', remotePath: '', lastScanAt: '', lastScanStartedAt: '', fullScanInProgress: false, updatedAt: '', createdAt: '', totalSongs: 100, totalAlbums: 10, totalArtists: 5, totalFolders: 5, totalFiles: 100, totalMissingFiles: 0, totalSize: 0, totalDuration: 0, defaultNewUsers: true },
      { id: 2, name: 'Podcasts', path: '/podcasts', remotePath: '', lastScanAt: '', lastScanStartedAt: '', fullScanInProgress: false, updatedAt: '', createdAt: '', totalSongs: 50, totalAlbums: 5, totalArtists: 5, totalFolders: 2, totalFiles: 50, totalMissingFiles: 0, totalSize: 0, totalDuration: 0, defaultNewUsers: false },
    ],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    navidromeUrl: 'http://test:4533',
    navidromeUsername: 'tester',
    navidromePassword: 'pw',
    tokenExpiry: 86400,
    debug: false,
    defaultLibraryIds: [],
    ...overrides,
  } as unknown as Config;
}

describe('LibraryManager.initialize JWT decoding', () => {
  let mockClient: MockNavidromeClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // libraryManager is a module singleton, so each test resets its state.
    libraryManager.reset();
    mockClient = createMockClient();
    // The logger writes to console.error, and the decoder logs every malformed token on purpose.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    libraryManager.reset();
  });

  describe('happy path', () => {
    it('decodes the JWT, fetches /user/{uid}, and stores the libraries', async () => {
      const token = makeJwt({ uid: 'user-uuid-123', sub: 'tester' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(
        mockClient as unknown as NavidromeClient,
        makeConfig(),
      );

      expect(libraryManager.isInitialized()).toBe(true);
      expect(libraryManager.getAvailableLibraries()).toHaveLength(2);
      expect(libraryManager.getActiveLibraryIds()).toEqual([1, 2]);
      expect(mockClient.request).toHaveBeenCalledWith('/user/user-uuid-123');
    });

    it('reads the token through the public getCurrentToken() API', async () => {
      // A read of the private authManager would skip getCurrentToken, so the mock sees no call.
      const token = makeJwt({ uid: 'abc' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(
        mockClient as unknown as NavidromeClient,
        makeConfig(),
      );

      expect(mockClient.getCurrentToken).toHaveBeenCalledTimes(1);
    });

    it('handles a JWT payload with base64url-distinguishing characters', async () => {
      const token = makeJwt({
        uid: 'with_uid_underscores-and-dashes',
        sub: 'user',
        // This value encodes to `_` and `-` in base64url, which atob cannot read.
        note: '????>>>>~~~~====<<<<????>>>>',
      });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(
        mockClient as unknown as NavidromeClient,
        makeConfig(),
      );

      expect(libraryManager.isInitialized()).toBe(true);
      expect(mockClient.request).toHaveBeenCalledWith(
        '/user/with_uid_underscores-and-dashes',
      );
    });

    it('scopes to the valid subset of configured defaultLibraryIds', async () => {
      const token = makeJwt({ uid: 'user-1' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(
        mockClient as unknown as NavidromeClient,
        makeConfig({ defaultLibraryIds: [2] }),
      );

      expect(libraryManager.isInitialized()).toBe(true);
      expect(libraryManager.getActiveLibraryIds()).toEqual([2]);
    });

    it('falls back to all libraries when no configured defaultLibraryId is valid', async () => {
      const token = makeJwt({ uid: 'user-1' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(
        mockClient as unknown as NavidromeClient,
        makeConfig({ defaultLibraryIds: [999] }),
      );

      expect(libraryManager.isInitialized()).toBe(true);
      expect(libraryManager.getActiveLibraryIds()).toEqual([1, 2]);
      // logger.warn writes to console.error with a `[WARN]` prefix and never calls console.warn.
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[WARN]',
        expect.stringContaining('No valid default libraries'),
      );
    });
  });

  describe('soft-fail paths (no crash, manager stays uninitialized)', () => {
    it('does not crash when the JWT is structurally malformed', async () => {
      mockClient.getCurrentToken.mockResolvedValue('not-a-jwt');

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('does not crash when the JWT payload is not valid JSON', async () => {
      const header = Buffer.from('{}').toString('base64url');
      const body = Buffer.from('this is not json').toString('base64url');
      const malformedToken = `${header}.${body}.sig`;
      mockClient.getCurrentToken.mockResolvedValue(malformedToken);

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('does not crash when the JWT payload lacks the `uid` claim', async () => {
      const token = makeJwt({ sub: 'tester', exp: 999 });
      mockClient.getCurrentToken.mockResolvedValue(token);

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('does not crash when `uid` claim is the wrong type', async () => {
      const token = makeJwt({ uid: 12345 });
      mockClient.getCurrentToken.mockResolvedValue(token);

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
    });
  });

  describe('hard-fail paths (rethrow — caller sees a clear error)', () => {
    it('throws when /user/{uid} fails after a successful JWT decode', async () => {
      const token = makeJwt({ uid: 'valid-uid' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockRejectedValue(new Error('HTTP 500'));

      // The outer wrapper's name replaces the loadUserLibraries prefix, so one prefix remains.
      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).rejects.toThrow("Tool 'LibraryManager.initialize' failed: HTTP 500");

      expect(libraryManager.isInitialized()).toBe(false);
    });
  });

  describe('idempotence', () => {
    it('initialize() is a no-op when already initialized', async () => {
      const token = makeJwt({ uid: 'user-1' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockResolvedValue(makeUserInfo());

      await libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig());
      await libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig());

      // One initialize() makes two requests, /user/{uid} and then /library for the stats.
      expect(mockClient.getCurrentToken).toHaveBeenCalledTimes(1);
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });

    it('concurrent initialize() calls share one load', async () => {
      mockClient.getCurrentToken.mockResolvedValue(makeJwt({ uid: 'user-1' }));
      mockClient.request.mockResolvedValue(makeUserInfo());

      await Promise.all([
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ]);

      expect(mockClient.getCurrentToken).toHaveBeenCalledTimes(1);
      expect(mockClient.request).toHaveBeenCalledTimes(2);
      expect(libraryManager.isInitialized()).toBe(true);
    });
  });

  // /api/user/{uid} zeros the per-library stats, so only /api/library supplies them.
  describe('library stats enrichment', () => {
    function libraryById(id: number) {
      return libraryManager.getAvailableLibraries().find((lib) => lib.id === id);
    }

    it('merges /library stats and scan time into the matching user library', async () => {
      mockClient.getCurrentToken.mockResolvedValue(makeJwt({ uid: 'user-1' }));
      mockClient.request.mockImplementation((endpoint: string) =>
        Promise.resolve(
          endpoint === '/library'
            ? [{ id: 1, totalSongs: 999, lastScanAt: '2026-01-01T00:00:00Z' }]
            : makeUserInfo(),
        ),
      );

      await libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig());

      expect(libraryById(1)).toMatchObject({ totalSongs: 999, lastScanAt: '2026-01-01T00:00:00Z' });
      expect(libraryById(2)).toMatchObject({ totalSongs: 50 });
    });

    it('still initializes with the user stats when /library fails', async () => {
      mockClient.getCurrentToken.mockResolvedValue(makeJwt({ uid: 'user-1' }));
      mockClient.request.mockImplementation((endpoint: string) =>
        endpoint === '/library' ? Promise.reject(new Error('500')) : Promise.resolve(makeUserInfo()),
      );

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(true);
      expect(libraryById(1)).toMatchObject({ totalSongs: 100 });
    });
  });
});
