/**
 * Navidrome MCP Server - LibraryManager unit tests
 * Copyright (C) 2025
 *
 * Locks in the fragility fixes for the `library-manager.ts:107-122` finding
 * from `03-core-infra-deep-review.md`:
 *   - Token + claims now go through `client.getCurrentToken()` (no
 *     `as unknown as` reach-around into private `authManager`).
 *   - Base64url-aware decode (Buffer, not atob).
 *   - Guarded JSON parse + shape validation: a malformed JWT no longer
 *     crashes MCP startup; it returns a soft-fail and leaves the manager
 *     uninitialized so library scoping is simply absent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryManager } from '../../../src/services/library-manager.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';

/** Build a JWT with the given payload claims. Signature is dummy. */
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

describe('LibraryManager.initialize — JWT decode fragility fixes', () => {
  let mockClient: MockNavidromeClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The singleton persists across tests; reset for isolation. `reset()`
    // clears the exported instance's internal state (userInfo, active library
    // ids, initialized flag, in-flight init promise). It does not rebuild the
    // singleton — every importer keeps the same `libraryManager` instance.
    libraryManager.reset();
    mockClient = createMockClient();
    // Silence stderr noise from the decoder's intentional error logs.
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
      // Verify the path-segment encoding sticks (defense-in-depth even
      // though IDs from Navidrome are alphanumeric).
      expect(mockClient.request).toHaveBeenCalledWith('/user/user-uuid-123');
    });

    it('uses the new public getCurrentToken() API (no authManager reach-around)', async () => {
      // The regression we're locking in: the old code did
      //   (client as unknown as { authManager }).authManager.getToken()
      // The fix routes through a public method instead. If a future
      // refactor reintroduces the private reach-around, this test fails
      // because the mock's getCurrentToken would never be called.
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
      // The original code used atob, which mishandles `_` and `-`. We
      // need the manager to work for any valid Navidrome-issued token.
      const token = makeJwt({
        uid: 'with_uid_underscores-and-dashes',
        sub: 'user',
        // Add some content that pushes the base64url alphabet difference.
        // We can't directly assert the encoded shape from here, but the
        // round-trip success is what matters.
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
  });

  describe('soft-fail paths (no crash, manager stays uninitialized)', () => {
    it('does not crash when the JWT is structurally malformed', async () => {
      // Old code: `JSON.parse(atob(undefined))` would throw synchronously.
      // New code: decoder returns null → initialize returns without
      // throwing, leaving the manager uninitialized for the session.
      mockClient.getCurrentToken.mockResolvedValue('not-a-jwt');

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      // Never hit /user/{uid} when uid extraction fails.
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
      const token = makeJwt({ sub: 'tester', exp: 999 }); // no uid
      mockClient.getCurrentToken.mockResolvedValue(token);

      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).resolves.toBeUndefined();

      expect(libraryManager.isInitialized()).toBe(false);
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('does not crash when `uid` claim is the wrong type', async () => {
      const token = makeJwt({ uid: 12345 }); // number, not string
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
      // If we got a valid uid but Navidrome rejects the lookup, something
      // is genuinely wrong and the server should surface it rather than
      // silently degrade.
      const token = makeJwt({ uid: 'valid-uid' });
      mockClient.getCurrentToken.mockResolvedValue(token);
      mockClient.request.mockRejectedValue(new Error('HTTP 500'));

      // ErrorFormatter.toolExecution dedupes nested wrapping (see
      // src-tools-3-1): loadUserLibraries already wraps the HTTP 500 with its
      // own tool-name prefix, so the outer initialize() wrapper preserves that
      // innermost meaningful message rather than stacking a second prefix. The
      // caller still sees a clear, rethrown error naming the failure site.
      await expect(
        libraryManager.initialize(mockClient as unknown as NavidromeClient, makeConfig()),
      ).rejects.toThrow(/Tool 'loadUserLibraries' failed: HTTP 500/);

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

      // Token + user fetched once; second initialize() short-circuits.
      // request() is called twice on first init: /user/{uid} then /library
      // (the enrichment step that backfills the stats Navidrome zeros out
      // on the user payload).
      expect(mockClient.getCurrentToken).toHaveBeenCalledTimes(1);
      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });
  });
});
