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
  playlistId: string;
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
  /** Total duration in seconds. `keep` only, since `durationFormatted` carries the same information. */
  duration?: number;
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
  /** 1-based position in the playlist, stringified. Shifts after any add, remove or reorder. */
  position: string;
  /** Song ID */
  songId: string;
  /** Playlist ID. Verbose-only, since it is identical on every row (the caller
      supplied it), so compact responses omit it to save context. */
  playlistId?: string;
  /** Song title */
  title: string;
  /** Album name */
  album: string;
  /** Artist name */
  artist: string;
  /** Album artist */
  albumArtist?: string;
  /** Duration in seconds. Verbose-only, since `durationFormatted` carries the same
      information in compact responses. */
  duration?: number;
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
  /** Specific discs to add. Navidrome matches album, release date and disc number together. */
  discs?: Array<{
    albumId: string;
    discNumber: number;
    releaseDate: string;
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
  /** Positions of the removed tracks, as Navidrome echoes them */
  positions: string[];
  /** Human-readable message */
  message: string;
  /** Whether the operation was successful */
  success: boolean;
}

/**
 * Request DTO for reordering a track in a playlist
 */
export interface ReorderPlaylistTrackRequest {
  /** Final 1-based position (as string) Navidrome moves the row to. Passing 0 returns HTTP 500. */
  insert_before: string;
}

/**
 * Response DTO for reordering a track, built from the request since Navidrome echoes only the input position.
 */
export interface ReorderPlaylistTrackResponse {
  /** Original 1-based position the track was moved FROM (= input position) */
  previousPosition: number;
  /** Final 1-based position of the track after the move. A downward move lands at insertBefore - 1. */
  newPosition: number;
  /** Human-readable confirmation message */
  message: string;
  /** Whether the operation succeeded */
  success: boolean;
}