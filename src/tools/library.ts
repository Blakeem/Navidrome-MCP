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

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { NavidromeClient } from '../client/navidrome-client.js';
import type { Config } from '../config.js';
import type { SongDTO, UserDetailsDTO, LibraryDTO, LibraryManagementResponse, SetActiveLibrariesRequest } from '../types/index.js';
import type { ToolCategory } from './handlers/registry.js';
import {
  getSong,
  getAlbum,
  getArtist,
  getSongPlaylists,
} from './media-library.js';
import { libraryManager } from '../services/library-manager.js';
import { logger } from '../utils/logger.js';
import { ErrorFormatter } from '../utils/error-formatter.js';

// Using the clean DTO for song data
export type Song = SongDTO;


/**
 * Get user details including library information with active status
 */
export async function getUserDetails(): Promise<UserDetailsDTO> {
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

    // Transform to clean DTO format
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
        lastScanAt: lib.lastScanAt === '0001-01-01T00:00:00Z' ? null : lib.lastScanAt,
        lastScanStartedAt: lib.lastScanStartedAt === '0001-01-01T00:00:00Z' ? null : lib.lastScanStartedAt,
        fullScanInProgress: lib.fullScanInProgress,
      },
      createdAt: lib.createdAt,
      updatedAt: lib.updatedAt,
    }));

    // Calculate summary statistics
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
        lastLoginAt: userInfo.lastLoginAt,
        lastAccessAt: userInfo.lastAccessAt,
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
    throw new Error(ErrorFormatter.toolExecution('getUserDetails', error));
  }
}

/**
 * Set active libraries for the user session
 */
export async function setActiveLibraries(args: unknown): Promise<LibraryManagementResponse> {
  try {
    const params = args as SetActiveLibrariesRequest;
    
    if (!Array.isArray(params.libraryIds)) {
      throw new Error('libraryIds must be an array of numbers');
    }

    if (params.libraryIds.length === 0) {
      throw new Error('At least one library ID must be provided');
    }

    // Validate all IDs are numbers
    for (const id of params.libraryIds) {
      if (typeof id !== 'number' || isNaN(id)) {
        throw new Error(`Invalid library ID: ${id}. Must be a number.`);
      }
    }

    // Set active libraries via LibraryManager
    libraryManager.setActiveLibraries(params.libraryIds);
    
    // Get updated active libraries for response
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to set active libraries:', errorMessage);
    
    return {
      success: false,
      message: `Failed to set active libraries: ${errorMessage}`,
      activeLibraries: [],
      totalCount: 0,
    };
  }
}

// Tool definitions for library category
const tools: Tool[] = [
  {
    name: 'get_song',
    description: 'Get detailed information about a specific song by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the song',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_album',
    description: 'Get detailed information about a specific album by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the album',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_artist',
    description: 'Get detailed information about a specific artist by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The unique ID of the artist',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_song_playlists',
    description: 'Get all playlists that contain a specific song',
    inputSchema: {
      type: 'object',
      properties: {
        songId: {
          type: 'string',
          description: 'The unique ID of the song',
        },
      },
      required: ['songId'],
    },
  },
  {
    name: 'get_user_details',
    description: 'Get user information including available libraries with active status flags',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'set_active_libraries',
    description: 'Set which libraries are active for filtering music content',
    inputSchema: {
      type: 'object',
      properties: {
        libraryIds: {
          type: 'array',
          items: {
            type: 'number',
          },
          description: 'Array of library IDs to set as active',
          minItems: 1,
        },
      },
      required: ['libraryIds'],
    },
  },
];

// Factory function for creating library tool category with dependencies  
export function createLibraryToolCategory(client: NavidromeClient, _config: Config): ToolCategory {
  return {
    tools,
    async handleToolCall(name: string, args: unknown): Promise<unknown> {
      switch (name) {
        case 'get_song':
          return await getSong(client, args);
        case 'get_album':
          return await getAlbum(client, args);
        case 'get_artist':
          return await getArtist(client, args);
        case 'get_song_playlists':
          return await getSongPlaylists(client, args);
        case 'get_user_details':
          return await getUserDetails();
        case 'set_active_libraries':
          return await setActiveLibraries(args);
        default:
          throw new Error(`Unknown library tool: ${name}`);
      }
    }
  };
}
