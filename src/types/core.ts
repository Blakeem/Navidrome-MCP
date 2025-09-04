/**
 * Navidrome MCP Server - Core Library Data Transfer Objects
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
 * Clean DTO for songs, optimized for LLM consumption
 */
export interface SongDTO {
  /** Unique song ID */
  id: string;
  /** Song title */
  title: string;
  /** Artist name */
  artist: string;
  /** Artist ID for lookups */
  artistId: string;
  /** Album name */
  album: string;
  /** Album ID for lookups */
  albumId: string;
  /** Primary genre */
  genre?: string;
  /** All genres associated with the song */
  genres?: string[];
  /** Release year */
  year?: number;
  /** Duration in human-readable format (MM:SS) */
  durationFormatted: string;
  /** ISO 8601 timestamp when added to library */
  addedDate: string;
  /** Full file path relative to library root */
  path?: string;
  /** Track number on album */
  trackNumber?: number;
  /** Number of times played */
  playCount?: number;
  /** User rating (1-5) */
  rating?: number;
  /** Whether the song is starred/favorited */
  starred?: boolean;
}


/**
 * Clean DTO for albums, optimized for LLM consumption
 */
export interface AlbumDTO {
  /** Unique album ID */
  id: string;
  /** Album name */
  name: string;
  /** Artist name */
  artist: string;
  /** Artist ID for lookups */
  artistId: string;
  /** Album artist (may differ from track artists) */
  albumArtist?: string;
  /** Album artist ID */
  albumArtistId?: string;
  /** Release year */
  releaseYear?: number;
  /** Primary genre */
  genre?: string;
  /** All genres */
  genres?: string[];
  /** Number of songs in album */
  songCount: number;
  /** Total duration in human-readable format */
  durationFormatted: string;
  /** Whether this is a compilation */
  compilation?: boolean;
  /** Number of times played */
  playCount?: number;
  /** User rating (1-5) */
  rating?: number;
  /** Whether starred */
  starred?: boolean;
}

/**
 * Clean DTO for artists, optimized for LLM consumption
 */
export interface ArtistDTO {
  /** Unique artist ID */
  id: string;
  /** Artist name */
  name: string;
  /** Number of albums */
  albumCount: number;
  /** Number of songs */
  songCount: number;
  /** All genres associated with artist */
  genres?: string[];
  /** Artist biography */
  biography?: string;
  /** Number of times played */
  playCount?: number;
  /** User rating (1-5) */
  rating?: number;
  /** Whether starred */
  starred?: boolean;
}

/**
 * Clean DTO for genres
 */
export interface GenreDTO {
  /** Unique genre ID */
  id: string;
  /** Genre name */
  name: string;
  /** Number of songs in this genre */
  songCount: number;
  /** Number of albums in this genre */
  albumCount: number;
}

/**
 * Response format for recently added songs resource
 */
export interface RecentlyAddedSongsResponse {
  /** Resource identifier */
  resource: string;
  /** Human-readable description */
  description: string;
  /** ISO 8601 timestamp of response */
  timestamp: string;
  /** Count of songs returned */
  count: number;
  /** Total songs available */
  total?: number;
  /** Offset for pagination */
  offset?: number;
  /** Limit used for this response */
  limit?: number;
  /** Array of recently added songs */
  songs: SongDTO[];
}