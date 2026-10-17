/**
 * Navidrome MCP Server - Library Manager Service
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

class LibraryManager {
  private static instance: LibraryManager | null = null;
  
  private userInfo: UserInfo | null = null;
  private activeLibraryIds: number[] = [];
  // Libraries whose stats came from /api/library. The others carry the zeroed stats of /api/user.
  private enrichedLibraryIds = new Set<number>();
  private initialized = false;
  // Concurrent initialize() calls share one load, so two loads never interleave writes to userInfo
  // and activeLibraryIds. Cleared on settle, so a soft-failed init can run again.
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): LibraryManager {
    LibraryManager.instance ??= new LibraryManager();
    return LibraryManager.instance;
  }

  /**
   * A JWT without a uid, or a user payload without libraries, soft-fails and leaves requests
   * unscoped. A rejected /user/{uid} lookup rethrows, since a refused valid uid is a real fault.
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
   * A false or a throw leaves the previous snapshot in place. Navidrome's /api/user/{id} returns
   * zeroed library stats and timestamps, so the real values come from /api/library.
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
      throw new Error(ErrorFormatter.toolExecution('loadUserLibraries', error));
    }

    // The payload is unvalidated, so an unexpected shape degrades to not loaded, not a TypeError.
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
   * The Navidrome docs mark /api/library admin-only. A library it does not cover stays out of
   * `enrichedIds`, so its zeroed stats are reported as unavailable instead of as zero.
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
   * Lets a long-lived server report current scans and libraries added after startup. A failed
   * reload keeps the previous snapshot, and a library the reload finds starts inactive.
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

  /**
   * A removed library's ID matches nothing, so an active set of only removed IDs would empty every
   * listing.
   */
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

  private applyDefaultConfiguration(config: Config): void {
    if (!this.userInfo) {
      throw new Error('User info not loaded');
    }

    const availableLibraryIds = this.userInfo.libraries.map(lib => lib.id);
    
    if (config.defaultLibraryIds && config.defaultLibraryIds.length > 0) {
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
      this.activeLibraryIds = availableLibraryIds;
      logger.debug('No default libraries configured, using all libraries');
    }
  }

  getAvailableLibraries(): LibraryInfo[] {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }
    return this.userInfo.libraries;
  }

  getActiveLibraryIds(): number[] {
    return [...this.activeLibraryIds];
  }

  getLibrariesWithActiveStatus(): Array<LibraryInfo & { isActive: boolean }> {
    if (!this.userInfo) {
      throw new Error('LibraryManager not initialized');
    }
    
    return this.userInfo.libraries.map(library => ({
      ...library,
      isActive: this.activeLibraryIds.includes(library.id)
    }));
  }

  /** One unknown ID rejects the entire request, so the selection never differs from the request. */
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

  /** Navidrome's web UI repeats library_id once per library, such as library_id=1&library_id=2. */
  getLibraryQueryParams(): URLSearchParams {
    const params = new URLSearchParams();
    
    for (const libraryId of this.activeLibraryIds) {
      params.append('library_id', libraryId.toString());
    }
    
    return params;
  }

  getUserInfo(): UserInfo | null {
    return this.userInfo;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** False when /api/library gave no stats for the library, so its zeroed stats mean nothing. */
  hasLibraryStats(id: number): boolean {
    return this.enrichedLibraryIds.has(id);
  }

  /** Test isolation only. */
  reset(): void {
    this.userInfo = null;
    this.activeLibraryIds = [];
    this.enrichedLibraryIds = new Set<number>();
    this.initialized = false;
    // The next initialize() starts a new load instead of awaiting one begun before the reset.
    // A reset that races an unsettled initialize() must await it, since that load still writes.
    this.initPromise = null;
  }
}

export const libraryManager = LibraryManager.getInstance();