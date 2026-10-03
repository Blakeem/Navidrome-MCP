/**
 * Navidrome MCP Server - Library Tools
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

import type { UserDetailsDTO, LibraryDTO, LibraryManagementResponse } from '../types/index.js';
import { SetActiveLibrariesSchema } from '../schemas/index.js';
import { libraryManager } from '../services/library-manager.js';
import { filterCacheManager } from '../services/filter-cache-manager.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';

/**
 * Get user details including library information with active status
 */
export function getUserDetails(): UserDetailsDTO {
  try {
    if (!libraryManager.isInitialized()) {
      throw new Error('LibraryManager not initialized');
    }

    const userInfo = libraryManager.getUserInfo();
    if (!userInfo) {
      throw new Error('User information not available');
    }

    const librariesWithStatus = libraryManager.getLibrariesWithActiveStatus();
    const activeLibraries = librariesWithStatus.filter(lib => lib.isActive);

    // Go's zero time is the server's "never set" value, so every timestamp maps it to null.
    const libraryDTOs: LibraryDTO[] = librariesWithStatus.map(lib => ({
      id: lib.id,
      name: lib.name,
      path: lib.path,
      isActive: lib.isActive,
      stats: {
        songs: lib.totalSongs,
        albums: lib.totalAlbums,
        artists: lib.totalArtists,
        totalSize: lib.totalSize,
        totalDuration: lib.totalDuration,
      },
      scanInfo: {
        lastScanAt: nullIfGoZeroTime(lib.lastScanAt),
        lastScanStartedAt: nullIfGoZeroTime(lib.lastScanStartedAt),
        fullScanInProgress: lib.fullScanInProgress,
      },
      createdAt: nullIfGoZeroTime(lib.createdAt),
      updatedAt: nullIfGoZeroTime(lib.updatedAt),
    }));

    const totalSongs = activeLibraries.reduce((sum, lib) => sum + lib.totalSongs, 0);
    const totalAlbums = activeLibraries.reduce((sum, lib) => sum + lib.totalAlbums, 0);
    const totalArtists = activeLibraries.reduce((sum, lib) => sum + lib.totalArtists, 0);
    const activeLibraryNames = activeLibraries.map(lib => lib.name);

    const result: UserDetailsDTO = {
      user: {
        id: userInfo.id,
        userName: userInfo.userName,
        name: userInfo.name,
        email: userInfo.email,
        isAdmin: userInfo.isAdmin,
        lastLoginAt: nullIfGoZeroTime(userInfo.lastLoginAt),
        lastAccessAt: nullIfGoZeroTime(userInfo.lastAccessAt),
      },
      libraries: {
        available: libraryDTOs,
        activeCount: activeLibraries.length,
        totalCount: librariesWithStatus.length,
      },
      summary: {
        totalSongs,
        totalAlbums,
        totalArtists,
        activeLibraryNames,
      },
    };

    logger.debug(`Retrieved user details for ${userInfo.userName} with ${activeLibraries.length}/${librariesWithStatus.length} active libraries`);
    return result;
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('get_user_details', error));
  }
}

/**
 * Set active libraries for the user session
 */
export async function setActiveLibraries(args: unknown): Promise<LibraryManagementResponse> {
  try {
    const params = SetActiveLibrariesSchema.parse(args);

    logger.debug('Tool setActiveLibraries called with args:', params);

    libraryManager.setActiveLibraries(params.libraryIds);
    // The filter maps hold only the tag values of the libraries active when they loaded.
    await filterCacheManager.reload();

    const availableLibraries = libraryManager.getAvailableLibraries();
    const activeLibraryIds = libraryManager.getActiveLibraryIds();
    const activeLibraries = availableLibraries
      .filter(lib => activeLibraryIds.includes(lib.id))
      .map(lib => ({ id: lib.id, name: lib.name }));

    const result: LibraryManagementResponse = {
      success: true,
      message: `Successfully set ${activeLibraries.length} active libraries: ${activeLibraries.map(lib => lib.name).join(', ')}`,
      activeLibraries,
      totalCount: availableLibraries.length,
    };

    logger.info(`Set active libraries: ${activeLibraries.map(lib => `${lib.name} (${lib.id})`).join(', ')}`);
    return result;
  } catch (error) {
    // A success:false payload in an MCP 200 body reads as a successful call to the LLM, so the failure is thrown.
    logger.error('Error setting active libraries:', error);
    throw new Error(ErrorFormatter.toolExecution('set_active_libraries', error));
  }
}
