/**
 * Navidrome MCP Server - Playlist Data Transfer Objects
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
 * Clean DTO for playlists
 */
export interface PlaylistDTO {
  /** Unique playlist ID */
  id: string;
  /** Playlist name */
  name: string;
  /** Playlist description */
  comment?: string;
  /** Whether playlist is public */
  public: boolean;
  /** Number of songs */
  songCount: number;
  /** Total duration in human-readable format */
  durationFormatted: string;
  /** Owner username */
  owner: string;
  /** Owner user ID */
  ownerId?: string;
  /** ISO 8601 timestamp when created */
  createdAt?: string;
  /** ISO 8601 timestamp when last updated */
  updatedAt?: string;
}

/**
 * DTO for individual tracks within a playlist
 */
export interface PlaylistTrackDTO {
  /** Track position ID in playlist */
  id: number;
  /** Song ID */
  mediaFileId: string;
  /** Playlist ID */
  playlistId: string;
  /** Song title */
  title: string;
  /** Album name */
  album: string;
  /** Artist name */
  artist: string;
  /** Album artist */
  albumArtist?: string;
  /** Duration in seconds */
  duration: number;
  /** Duration in human-readable format */
  durationFormatted: string;
  /** Bit rate */
  bitRate?: number;
  /** File path */
  path?: string;
  /** Track number on original album */
  trackNumber?: number;
  /** Release year */
  year?: number;
  /** Primary genre */
  genre?: string;
}

/**
 * Request DTO for creating a new playlist
 */
export interface CreatePlaylistRequest {
  /** Playlist name (required) */
  name: string;
  /** Playlist description */
  comment?: string;
  /** Whether playlist should be public */
  public?: boolean;
}

/**
 * Request DTO for updating a playlist
 */
export interface UpdatePlaylistRequest {
  /** New playlist name */
  name?: string;
  /** New playlist description */
  comment?: string;
  /** New public visibility setting */
  public?: boolean;
}

/**
 * Request DTO for adding tracks to a playlist
 */
export interface AddTracksToPlaylistRequest {
  /** Song IDs to add */
  ids?: string[];
  /** Album IDs to add (all tracks) */
  albumIds?: string[];
  /** Artist IDs to add (all tracks) */
  artistIds?: string[];
  /** Specific discs to add */
  discs?: Array<{
    albumId: string;
    discNumber: number;
  }>;
}

/**
 * Response DTO for adding tracks to a playlist
 */
export interface AddTracksToPlaylistResponse {
  /** Number of tracks added */
  added: number;
  /** Human-readable message */
  message: string;
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Response DTO for removing tracks from a playlist
 */
export interface RemoveTracksFromPlaylistResponse {
  /** IDs of removed tracks */
  ids: string[];
  /** Human-readable message */
  message: string;
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Request DTO for reordering a track in a playlist
 */
export interface ReorderPlaylistTrackRequest {
  /** New position (0-based index) as string */
  insert_before: string;
}

/**
 * Response DTO for reordering a track
 */
export interface ReorderPlaylistTrackResponse {
  /** Track position ID */
  id: number;
}