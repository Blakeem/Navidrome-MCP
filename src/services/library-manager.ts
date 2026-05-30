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
  lastLoginAt: string;
  lastAccessAt: string;
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
  private initialized = false;

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
   *   - JWT decode / `uid` extraction failure: SOFT FAIL. The manager stays
   *     `initialized = false`; the client falls back to "no library scoping"
   *     and the rest of the server keeps running. This was the historical
   *     single point of startup failure flagged in `03-core-infra-deep-review`.
   *   - `/user/{uid}` HTTP failure: HARD FAIL (rethrown). If we can decode
   *     `uid` but Navidrome rejects the lookup, something is genuinely wrong
   *     and surfacing it is more useful than silently proceeding unscoped.
   */
  async initialize(client: NavidromeClient, config: Config): Promise<void> {
    if (this.initialized) {
      logger.debug('LibraryManager already initialized');
      return;
    }

    try {
      const loaded = await this.loadUserLibraries(client);
      if (!loaded) {
        // JWT decode failed — already logged with diagnostic detail. Stay
        // uninitialized; library_id filtering is simply absent for this
        // session. Tools that depend on it (e.g. `set_active_libraries`)
        // will throw their own clear "not initialized" error if invoked.
        logger.warn(
          'LibraryManager: skipping initialization (could not extract user ID from JWT). ' +
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
  }

  /**
   * Load user libraries from Navidrome API. Returns true on success, false
   * when the JWT couldn't be decoded into a usable `uid`.
   *
   * Token + claims access goes through `client.getCurrentToken()` (public
   * method) and `decodeJwtPayload` (Buffer-base64url + guarded JSON.parse +
   * shape check). The previous implementation reached into `client.authManager`
   * via `as unknown as`, used `atob` (mishandles base64url), and called
   * `JSON.parse` outside any try/catch — three compounding fragility bugs.
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
      // decodeJwtPayload already logged the specific failure mode. Caller
      // (initialize) treats false as "skip, don't crash".
      return false;
    }

    try {
      this.userInfo = await client.request<UserInfo>(
        `/user/${encodeURIComponent(claims.uid)}`,
      );
    } catch (error) {
      // /user/{uid} failure is genuinely abnormal — uid was valid in the
      // JWT but the API rejected it. Bubble up so initialize() can wrap it.
      throw new Error(ErrorFormatter.toolExecution('loadUserLibraries', error));
    }

    await this.enrichLibraryStats(client);

    logger.debug(
      `Loaded ${this.userInfo.libraries.length} libraries for user ${this.userInfo.userName}`,
    );
    return true;
  }

  /**
   * Best-effort enrichment of library stats from `/api/library`. The user
   * endpoint returns stat fields as zero / Go zero-time; this endpoint
   * returns the real values. We log + swallow errors here — the rest of the
   * server can keep running with the unenriched user payload (stats just
   * show as zero, the existing observed behaviour).
   */
  private async enrichLibraryStats(client: NavidromeClient): Promise<void> {
    if (!this.userInfo) {
      return;
    }
    try {
      const libraries = await client.request<LibraryInfo[]>('/library');
      if (!Array.isArray(libraries)) {
        return;
      }
      const byId = new Map<number, LibraryInfo>();
      for (const lib of libraries) {
        if (typeof lib.id === 'number') {
          byId.set(lib.id, lib);
        }
      }

      // Mutate in place so any downstream snapshots stay consistent.
      this.userInfo.libraries = this.userInfo.libraries.map((userLib) => {
        const stats = byId.get(userLib.id);
        if (stats === undefined) {
          return userLib;
        }
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
    } catch (error) {
      logger.warn(
        `LibraryManager: failed to enrich library stats from /api/library; stats will show as zero: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
   * Set active libraries (replaces current selection)
   */
  setActiveLibraries(libraryIds: number[]): void {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }

    const availableLibraryIds = this.userInfo.libraries.map(lib => lib.id);
    const validLibraryIds = libraryIds.filter(id => availableLibraryIds.includes(id));
    
    if (validLibraryIds.length === 0) {
      throw new Error(`No valid library IDs provided. Available: ${availableLibraryIds.join(', ')}`);
    }

    const invalidIds = libraryIds.filter(id => !availableLibraryIds.includes(id));
    if (invalidIds.length > 0) {
      logger.warn(`Invalid library IDs ignored: ${invalidIds.join(', ')}`);
    }

    this.activeLibraryIds = validLibraryIds;
    logger.info(`Active libraries set to: ${validLibraryIds.join(', ')}`);
  }

  /**
   * Add a library to the active set
   */
  addActiveLibrary(libraryId: number): void {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }

    const availableLibraryIds = this.userInfo.libraries.map(lib => lib.id);
    
    if (!availableLibraryIds.includes(libraryId)) {
      throw new Error(`Library ID ${libraryId} not available. Available: ${availableLibraryIds.join(', ')}`);
    }

    if (!this.activeLibraryIds.includes(libraryId)) {
      this.activeLibraryIds.push(libraryId);
      logger.info(`Added library ${libraryId} to active set`);
    }
  }

  /**
   * Remove a library from the active set
   */
  removeActiveLibrary(libraryId: number): void {
    const index = this.activeLibraryIds.indexOf(libraryId);
    if (index > -1) {
      this.activeLibraryIds.splice(index, 1);
      logger.info(`Removed library ${libraryId} from active set`);
    }
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

  /**
   * Reset the library manager (for testing)
   */
  reset(): void {
    this.userInfo = null;
    this.activeLibraryIds = [];
    this.initialized = false;
    LibraryManager.instance = null;
  }
}

// Export singleton instance getter for convenience
export const libraryManager = LibraryManager.getInstance();