/**
 * Navidrome MCP Server - Playlist Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface PlaylistDTO {
  id: string;
  name: string;
  comment?: string;
  public: boolean;
  songCount: number;
  durationFormatted: string;
  /** Seconds. Verbose or `keep` only, since `durationFormatted` carries the same information. */
  duration?: number;
  owner: string;
  ownerId?: string;
  /** ISO 8601. */
  createdAt?: string;
  /** ISO 8601. */
  updatedAt?: string;
}

export interface PlaylistTrackDTO {
  /** 1-based position in the playlist, stringified. Shifts after any add, remove or reorder. */
  position: string;
  songId: string;
  /** Verbose or `keep` only, since every row repeats the playlist the caller named. */
  playlistId?: string;
  title: string;
  album: string;
  artist: string;
  albumArtist?: string;
  /** Seconds. Verbose or `keep` only, since `durationFormatted` carries the same information. */
  duration?: number;
  durationFormatted: string;
  /** kbps. */
  bitRate?: number;
  /** Relative to the library root. */
  path?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
}

export interface CreatePlaylistRequest {
  name: string;
  comment?: string;
  public?: boolean;
}

export interface UpdatePlaylistRequest {
  name?: string;
  comment?: string;
  public?: boolean;
}

export interface AddTracksToPlaylistRequest {
  /** Song IDs. */
  ids?: string[];
  albumIds?: string[];
  artistIds?: string[];
  /** Navidrome matches a disc on album, release date and disc number together. */
  discs?: Array<{
    albumId: string;
    discNumber: number;
    releaseDate: string;
  }>;
}

export interface AddTracksToPlaylistResponse {
  added: number;
  message: string;
  success: boolean;
}

export interface RemoveTracksFromPlaylistResponse {
  /** Deduplicated. */
  positions: string[];
  message: string;
  success: boolean;
}

export interface ReorderPlaylistTrackRequest {
  /** Despite the name, Navidrome moves the row to this final 1-based position. */
  insert_before: string;
}

/** Built from the request, since Navidrome echoes only the input position. */
export interface ReorderPlaylistTrackResponse {
  previousPosition: string;
  /** A downward move lands at insertBefore - 1. */
  newPosition: string;
  message: string;
  success: boolean;
}