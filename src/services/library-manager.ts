/**
 * Navidrome MCP Server - Library Manager Service
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

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { decodeJwtPayload } from '../utils/jwt-decode.js';

interface LibraryInfo {
  id: number;
  name: string;
  path: string;
  remotePath: string;
  lastScanAt: string;
  lastScanStartedAt: string;
  fullScanInProgress: boolean;
  updatedAt: string;
  createdAt: string;
  totalSongs: number;
  totalAlbums: number;
  totalArtists: number;
  totalFolders: number;
  totalFiles: number;
  totalMissingFiles: number;
  totalSize: number;
  totalDuration: number;
  defaultNewUsers: boolean;
}

interface UserInfo {
  id: string;
  userName: string;
  name: string;
  email: string;
  isAdmin: boolean;
  lastLoginAt: string | null;
  lastAccessAt: string | null;
  createdAt: string;
  updatedAt: string;
  libraries: LibraryInfo[];
}

/**
 * Singleton service for managing library state and filtering across the application
 */
class LibraryManager {
  private static instance: LibraryManager | null = null;
  
  private userInfo: UserInfo | null = null;
  private activeLibraryIds: number[] = [];
  // Libraries whose stats came from /api/library. The others carry the zeroed stats of /api/user.
  private enrichedLibraryIds = new Set<number>();
  private initialized = false;
  // Single-flight init: concurrent callers await the same in-flight promise so
  // two callers can't both run loadUserLibraries() and clobber userInfo /
  // activeLibraryIds. Cleared on settle so a later re-init can run if needed.
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): LibraryManager {
    LibraryManager.instance ??= new LibraryManager();
    return LibraryManager.instance;
  }

  /**
   * Initialize the library manager with user data and default configuration.
   *
   * Failure modes are split deliberately:
   *   - A JWT without a decodable `uid`, or a `/user/{uid}` payload without a
   *     libraries array: SOFT FAIL. The manager stays `initialized = false`.
   *     The client falls back to "no library scoping" and the rest of the
   *     server keeps running.
   *   - `/user/{uid}` HTTP failure: HARD FAIL (rethrown). If we can decode
   *     `uid` but Navidrome rejects the lookup, something is genuinely wrong
   *     and surfacing it is more useful than silently proceeding unscoped.
   */
  async initialize(client: NavidromeClient, config: Config): Promise<void> {
    if (this.initialized) {
      logger.debug('LibraryManager already initialized');
      return;
    }

    this.initPromise ??= (async (): Promise<void> => {
      try {
        const loaded = await this.loadUserLibraries(client);
        if (!loaded) {
          // loadUserLibraries already logged the cause. Library scoping stays off for this run.
          logger.warn(
            'LibraryManager: skipping initialization (user libraries could not be loaded, see the previous warning). ' +
              'Library scoping will be disabled for this session.',
          );
          return;
        }

        this.applyDefaultConfiguration(config);
        this.initialized = true;
        logger.info(
          `LibraryManager initialized with ${this.userInfo?.libraries.length ?? 0} libraries, ${this.activeLibraryIds.length} active`,
        );
      } catch (error) {
        throw new Error(ErrorFormatter.toolExecution('LibraryManager.initialize', error));
      }
    })();

    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Load user libraries from Navidrome API. Returns true on success. Returns
   * false when the JWT has no decodable `uid`, or when the `/user/{uid}`
   * payload has no libraries array. A false or a throw leaves the previous
   * snapshot in place.
   *
   * After the user payload arrives we make a second call to `/api/library`
   * and merge the per-library stats (`totalSongs`/`totalAlbums`/...) and
   * timestamps (`createdAt`/`updatedAt`/`lastScanAt`) into the user's library
   * list. `/api/user/{id}` zeros these out (server-side bug as of 0.55) and
   * `/api/library` is the only endpoint that returns real values.
   */
  private async loadUserLibraries(client: NavidromeClient): Promise<boolean> {
    const token = await client.getCurrentToken();
    const claims = decodeJwtPayload(token);
    if (claims === null) {
      // decodeJwtPayload already logged the specific failure mode.
      return false;
    }

    let userInfo: UserInfo;
    try {
      userInfo = await client.request<UserInfo>(
        `/user/${encodeURIComponent(claims.uid)}`,
      );
    } catch (error) {
      // /user/{uid} failure is genuinely abnormal. The uid was valid in the
      // JWT but the API rejected it. Bubble up so initialize() can wrap it.
      throw new Error(ErrorFormatter.toolExecution('loadUserLibraries', error));
    }

    // The response is typed as UserInfo but unvalidated. A non-conforming
    // payload (unexpected/future API shape) should degrade to "not loaded"
    // rather than throw a TypeError deeper in.
    if (!Array.isArray(userInfo.libraries)) {
      logger.warn(
        `User payload for ${claims.uid} has no libraries array; skipping library initialization`,
      );
      return false;
    }

    const enrichment = await this.enrichLibraryStats(client, userInfo.libraries);
    this.userInfo = { ...userInfo, libraries: enrichment.libraries };
    this.enrichedLibraryIds = enrichment.enrichedIds;

    logger.debug(
      `Loaded ${this.userInfo.libraries.length} libraries for user ${this.userInfo.userName}`,
    );
    return true;
  }

  /**
   * Best-effort enrichment of library stats from `/api/library`, which the
   * Navidrome docs mark admin-only. A library it does not cover keeps the
   * zeroed stats of the user endpoint and is left out of `enrichedIds`, so
   * its stats are reported as unavailable instead of as zero.
   */
  private async enrichLibraryStats(
    client: NavidromeClient,
    userLibraries: LibraryInfo[],
  ): Promise<{ libraries: LibraryInfo[]; enrichedIds: Set<number> }> {
    const enrichedIds = new Set<number>();
    try {
      const libraries = await client.request<LibraryInfo[]>('/library');
      if (!Array.isArray(libraries)) {
        return { libraries: userLibraries, enrichedIds };
      }
      const byId = new Map<number, LibraryInfo>();
      for (const lib of libraries) {
        if (typeof lib.id === 'number') {
          byId.set(lib.id, lib);
        }
      }

      const enrichedLibraries = userLibraries.map((userLib) => {
        const stats = byId.get(userLib.id);
        if (stats === undefined) {
          return userLib;
        }
        enrichedIds.add(userLib.id);
        return {
          ...userLib,
          totalSongs: stats.totalSongs,
          totalAlbums: stats.totalAlbums,
          totalArtists: stats.totalArtists,
          totalFolders: stats.totalFolders,
          totalFiles: stats.totalFiles,
          totalMissingFiles: stats.totalMissingFiles,
          totalSize: stats.totalSize,
          totalDuration: stats.totalDuration,
          lastScanAt: stats.lastScanAt,
          lastScanStartedAt: stats.lastScanStartedAt,
          fullScanInProgress: stats.fullScanInProgress,
          createdAt: stats.createdAt,
          updatedAt: stats.updatedAt,
        };
      });
      return { libraries: enrichedLibraries, enrichedIds };
    } catch (error) {
      logger.warn(
        `LibraryManager: failed to enrich library stats from /api/library. Stats will be reported as unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { libraries: userLibraries, enrichedIds };
    }
  }

  /**
   * Reload the library list and stats, so a long-lived server reports current
   * scans and libraries added after startup. A failed reload keeps the
   * previous snapshot. A library found by the reload starts inactive.
   */
  async refresh(client: NavidromeClient): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      const loaded = await this.loadUserLibraries(client);
      if (!loaded) {
        logger.warn('LibraryManager: library refresh loaded no library list. Keeping the previous snapshot.');
        return;
      }
    } catch (error) {
      logger.warn(
        `LibraryManager: library refresh failed. Keeping the previous snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    this.pruneActiveLibraries();
  }

  /** An active ID of a removed library would scope requests to nothing, so it is dropped. */
  private pruneActiveLibraries(): void {
    const availableLibraryIds = this.getAvailableLibraries().map(lib => lib.id);
    const keptIds = this.activeLibraryIds.filter(id => availableLibraryIds.includes(id));
    if (keptIds.length === 0) {
      logger.warn('LibraryManager: every active library was removed. Using all libraries.');
      this.activeLibraryIds = availableLibraryIds;
      return;
    }
    this.activeLibraryIds = keptIds;
  }

  /**
   * Apply default library configuration from config
   */
  private applyDefaultConfiguration(config: Config): void {
    if (!this.userInfo) {
      throw new Error('User info not loaded');
    }

    const availableLibraryIds = this.userInfo.libraries.map(lib => lib.id);
    
    // Apply default libraries from config if specified
    if (config.defaultLibraryIds && config.defaultLibraryIds.length > 0) {
      // Validate that configured library IDs exist
      const validLibraryIds = config.defaultLibraryIds.filter(id => 
        availableLibraryIds.includes(id)
      );
      
      if (validLibraryIds.length === 0) {
        logger.warn(`No valid default libraries found in config. Using all libraries.`);
        this.activeLibraryIds = availableLibraryIds;
      } else {
        this.activeLibraryIds = validLibraryIds;
        logger.info(`Applied default libraries: ${validLibraryIds.join(', ')}`);
      }
    } else {
      // No default configuration - use all libraries (backward compatibility)
      this.activeLibraryIds = availableLibraryIds;
      logger.debug('No default libraries configured, using all libraries');
    }
  }

  /**
   * Get all available libraries for the user
   */
  getAvailableLibraries(): LibraryInfo[] {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }
    return this.userInfo.libraries;
  }

  /**
   * Get currently active library IDs
   */
  getActiveLibraryIds(): number[] {
    return [...this.activeLibraryIds];
  }

  /**
   * Get libraries with active status marked
   */
  getLibrariesWithActiveStatus(): Array<LibraryInfo & { isActive: boolean }> {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }
    
    return this.userInfo.libraries.map(library => ({
      ...library,
      isActive: this.activeLibraryIds.includes(library.id)
    }));
  }

  /**
   * Set active libraries (replaces current selection). One unknown ID rejects
   * the whole request, so the selection never differs from what was asked.
   */
  setActiveLibraries(libraryIds: number[]): void {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }

    const availableLibraryIds = this.userInfo.libraries.map(lib => lib.id);
    const invalidIds = libraryIds.filter(id => !availableLibraryIds.includes(id));
    if (invalidIds.length > 0) {
      throw new Error(
        `Library IDs not available to this user: ${invalidIds.join(', ')}. Available: ${availableLibraryIds.join(', ')}. Call get_user_details for the library IDs.`,
      );
    }

    this.activeLibraryIds = [...libraryIds];
    logger.info(`Active libraries set to: ${libraryIds.join(', ')}`);
  }

  /**
   * Generate library query parameters for API requests
   * Returns duplicate parameters in format: library_id=1&library_id=2
   */
  getLibraryQueryParams(): URLSearchParams {
    const params = new URLSearchParams();
    
    // Add duplicate library_id parameters as discovered from frontend
    for (const libraryId of this.activeLibraryIds) {
      params.append('library_id', libraryId.toString());
    }
    
    return params;
  }

  /**
   * Get user information
   */
  getUserInfo(): UserInfo | null {
    return this.userInfo;
  }

  /**
   * Check if library manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** False when /api/library supplied no stats for the library, so its zeroed stats are not real counts. */
  hasLibraryStats(id: number): boolean {
    return this.enrichedLibraryIds.has(id);
  }

  /**
   * Reset the library manager (for testing)
   */
  reset(): void {
    this.userInfo = null;
    this.activeLibraryIds = [];
    this.enrichedLibraryIds = new Set<number>();
    this.initialized = false;
    // Clear any in-flight init promise so a fresh initialize() can run after
    // reset instead of awaiting the stale (pre-reset) one. Note: a reset that
    // races an unsettled initialize() should still await it first. This only
    // prevents the next initialize() from short-circuiting on the old promise.
    this.initPromise = null;
  }
}

// Export singleton instance getter for convenience
export const libraryManager = LibraryManager.getInstance();