/**
 * Navidrome MCP Server - Library Data Transfer Objects
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

/**
 * Clean DTO for library information with LLM-friendly formatting
 */
export interface LibraryDTO {
  id: number;
  name: string;
  path: string;
  isActive: boolean;
  stats: {
    songs: number;
    albums: number;
    artists: number;
    totalSize: number;
    totalDuration: number;
  };
  scanInfo: {
    lastScanAt: string | null;
    lastScanStartedAt: string | null;
    fullScanInProgress: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Clean DTO for user details with library information
 */
export interface UserDetailsDTO {
  user: {
    id: string;
    userName: string;
    name: string;
    email: string;
    isAdmin: boolean;
    lastLoginAt: string;
    lastAccessAt: string;
  };
  libraries: {
    available: LibraryDTO[];
    activeCount: number;
    totalCount: number;
  };
  summary: {
    totalSongs: number;
    totalAlbums: number;
    totalArtists: number;
    activeLibraryNames: string[];
  };
}

/**
 * Response for library management operations
 */
export interface LibraryManagementResponse {
  success: boolean;
  message: string;
  activeLibraries: Array<{
    id: number;
    name: string;
  }>;
  totalCount: number;
}

/**
 * Request for setting active libraries
 */
export interface SetActiveLibrariesRequest {
  libraryIds: number[];
}