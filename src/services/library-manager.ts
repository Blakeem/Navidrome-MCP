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

export interface LibraryInfo {
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

export interface UserInfo {
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
export class LibraryManager {
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
   * Initialize the library manager with user data and default configuration
   */
  async initialize(client: NavidromeClient, config: Config): Promise<void> {
    if (this.initialized) {
      logger.debug('LibraryManager already initialized');
      return;
    }

    try {
      // Get user info including libraries from authentication
      await this.loadUserLibraries(client);
      
      // Apply default library configuration
      this.applyDefaultConfiguration(config);
      
      this.initialized = true;
      logger.info(`LibraryManager initialized with ${this.userInfo?.libraries.length ?? 0} libraries, ${this.activeLibraryIds.length} active`);
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('LibraryManager.initialize', error));
    }
  }

  /**
   * Load user libraries from Navidrome API
   */
  private async loadUserLibraries(client: NavidromeClient): Promise<void> {
    try {
      // First authenticate to get user ID
      const token = await (client as unknown as { authManager: { getToken(): Promise<string> } }).authManager.getToken();
      
      // Decode the JWT to get user ID (simple base64 decode)
      const tokenParts = token.split('.');
      if (tokenParts.length !== 3 || tokenParts[1] === null || tokenParts[1] === undefined || tokenParts[1] === '') {
        throw new Error('Invalid JWT token format');
      }
      const payload = JSON.parse(atob(tokenParts[1]));
      const userId = payload.uid;

      if (userId === null || userId === undefined || userId === '') {
        throw new Error('Unable to extract user ID from token');
      }

      // Get user info including libraries
      this.userInfo = await client.request<UserInfo>(`/user/${userId}`);
      
      logger.debug(`Loaded ${this.userInfo.libraries.length} libraries for user ${this.userInfo.userName}`);
    } catch (error) {
      throw new Error(ErrorFormatter.toolExecution('loadUserLibraries', error));
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