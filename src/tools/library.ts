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

import type { NavidromeClient } from '../client/navidrome-client.js';
import type { UserDetailsDTO, LibraryDTO, LibraryManagementResponse } from '../types/index.js';
import { SetActiveLibrariesSchema } from '../schemas/index.js';
import { libraryManager } from '../services/library-manager.js';
import { filterCacheManager } from '../services/filter-cache-manager.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { nullIfGoZeroTime } from '../utils/go-time.js';

const LIBRARY_SELECTION_UNAVAILABLE =
  'Library selection is unavailable for this server run. The user libraries could not be loaded at startup, and the server log names the cause. ' +
  'Library filtering is off, so search and list tools return content from every library the account can access. ' +
  'Restart the MCP server after checking the Navidrome version and account.';

interface LibraryTotals {
  totalSongs: number;
  totalAlbums: number;
  totalArtists: number;
}

/**
 * Get user details including library information with active status.
 * The library list reloads on every call, so a long-lived server reports current scans and new libraries.
 */
export async function getUserDetails(client: NavidromeClient): Promise<UserDetailsDTO> {
  try {
    if (!libraryManager.isInitialized()) {
      throw new Error(LIBRARY_SELECTION_UNAVAILABLE);
    }

    await libraryManager.refresh(client);

    const userInfo = libraryManager.getUserInfo();
    if (!userInfo) {
      throw new Error('User information not available');
    }

    const librariesWithStatus = libraryManager.getLibrariesWithActiveStatus();
    const activeLibraries = librariesWithStatus.filter(lib => lib.isActive);

    // Go's zero time is the server's "never set" value, so every timestamp maps it to null.
    const libraryDTOs: LibraryDTO[] = librariesWithStatus.map(lib => {
      const hasStats = libraryManager.hasLibraryStats(lib.id);
      return {
        id: lib.id,
        name: lib.name,
        path: lib.path,
        isActive: lib.isActive,
        stats: hasStats
          ? {
              totalSongs: lib.totalSongs,
              totalAlbums: lib.totalAlbums,
              totalArtists: lib.totalArtists,
              totalSize: lib.totalSize,
              totalDuration: lib.totalDuration,
            }
          : null,
        scanInfo: hasStats
          ? {
              lastScanAt: nullIfGoZeroTime(lib.lastScanAt),
              lastScanStartedAt: nullIfGoZeroTime(lib.lastScanStartedAt),
              fullScanInProgress: lib.fullScanInProgress,
            }
          : null,
        createdAt: nullIfGoZeroTime(lib.createdAt),
        updatedAt: nullIfGoZeroTime(lib.updatedAt),
      };
    });

    const totals = await fetchActiveLibraryTotals(client, activeLibraries);
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
        ...totals,
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
 * X-Total-Count counts an artist shared by two libraries once and is readable by non-admins,
 * unlike the per-library stats, which serve only as the fallback for a missing header.
 */
async function fetchActiveLibraryTotals(
  client: NavidromeClient,
  activeLibraries: readonly LibraryTotals[],
): Promise<LibraryTotals> {
  const [songs, albums, artists] = await Promise.all([
    client.requestWithLibraryFilterAndMeta<unknown>('/song?_start=0&_end=1'),
    client.requestWithLibraryFilterAndMeta<unknown>('/album?_start=0&_end=1'),
    client.requestWithLibraryFilterAndMeta<unknown>('/artist?_start=0&_end=1'),
  ]);

  return {
    totalSongs: songs.total ?? activeLibraries.reduce((sum, lib) => sum + lib.totalSongs, 0),
    totalAlbums: albums.total ?? activeLibraries.reduce((sum, lib) => sum + lib.totalAlbums, 0),
    totalArtists: artists.total ?? activeLibraries.reduce((sum, lib) => sum + lib.totalArtists, 0),
  };
}

/**
 * Set active libraries for the user session
 */
export async function setActiveLibraries(client: NavidromeClient, args: unknown): Promise<LibraryManagementResponse> {
  try {
    if (!libraryManager.isInitialized()) {
      throw new Error(LIBRARY_SELECTION_UNAVAILABLE);
    }

    const params = SetActiveLibrariesSchema.parse(args);

    logger.debug('Tool setActiveLibraries called with args:', params);

    // A library added after startup stays unknown until the list reloads.
    const knownLibraryIds = libraryManager.getAvailableLibraries().map(lib => lib.id);
    if (params.libraryIds.some(id => !knownLibraryIds.includes(id))) {
      await libraryManager.refresh(client);
    }

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
      message: `Successfully set ${activeLibraries.length} active ${activeLibraries.length === 1 ? 'library' : 'libraries'}: ${activeLibraries.map(lib => lib.name).join(', ')}`,
      activeLibraries,
      totalCount: availableLibraries.length,
    };

    return result;
  } catch (error) {
    // A success:false payload in an MCP 200 body reads as a successful call to the LLM, so the failure is thrown.
    throw new Error(ErrorFormatter.toolExecution('set_active_libraries', error));
  }
}
