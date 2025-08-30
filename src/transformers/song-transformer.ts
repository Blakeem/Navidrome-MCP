/**
 * Navidrome MCP Server - Song Data Transformers
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

import type { SongDTO, AlbumDTO, ArtistDTO, GenreDTO, PlaylistDTO } from '../types/dto.js';

// For backward compatibility
export type RecentlyAddedSongDTO = SongDTO;

/**
 * Raw song data from Navidrome API
 */
interface RawSong {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  albumArtist?: string;
  albumArtistId?: string;
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  year?: number;
  duration?: number;
  trackNumber?: number;
  playCount?: number;
  rating?: number;
  starred?: boolean;
  createdAt?: string;
  path?: string;
  [key: string]: unknown; // Allow other fields we don't use
}

interface RawAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  albumArtist?: string;
  albumArtistId?: string;
  releaseYear?: number;
  genre?: string;
  genres?: Array<{ id: string; name: string }>;
  songCount: number;
  duration?: number;
  compilation?: boolean;
  playCount?: number;
  rating?: number;
  starred?: boolean;
  [key: string]: unknown;
}

interface RawArtist {
  id: string;
  name: string;
  albumCount: number;
  songCount: number;
  genres?: string[];
  biography?: string;
  playCount?: number;
  rating?: number;
  starred?: boolean;
  [key: string]: unknown;
}

interface RawGenre {
  id: string;
  name: string;
  songCount: number;
  albumCount: number;
  [key: string]: unknown;
}

interface RawPlaylist {
  id: string;
  name: string;
  comment?: string;
  public: boolean;
  songCount: number;
  duration?: number;
  owner: string;
  [key: string]: unknown;
}

/**
 * Format duration from seconds to MM:SS format
 * @param seconds Duration in seconds
 * @returns Formatted string like "3:45"
 */
function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) {
    return '0:00';
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

/**
 * Extract the primary genre from various formats
 * @param rawSong The raw song data
 * @returns The primary genre name or undefined
 */
function extractGenre(rawSong: RawSong): string | undefined {
  // Try genres array first (newer format)
  if (rawSong.genres && Array.isArray(rawSong.genres) && rawSong.genres.length > 0) {
    const firstGenre = rawSong.genres[0];
    if (firstGenre) {
      return firstGenre.name;
    }
  }
  // Fall back to genre string
  if (rawSong.genre) {
    return rawSong.genre;
  }
  return undefined;
}

/**
 * Extract all genres from the raw song data
 * @param rawSong The raw song data
 * @returns Array of genre names or undefined
 */
function extractAllGenres(rawSong: RawSong): string[] | undefined {
  // Try genres array first (newer format)
  if (rawSong.genres && Array.isArray(rawSong.genres) && rawSong.genres.length > 0) {
    return rawSong.genres.map(g => g.name).filter(Boolean);
  }
  // Fall back to single genre string as array
  if (rawSong.genre) {
    return [rawSong.genre];
  }
  return undefined;
}


/**
 * Transform a raw song from Navidrome API to a clean DTO
 * @param rawSong Raw song data from API
 * @returns Clean song DTO for LLM consumption
 */
export function transformToSongDTO(rawSong: RawSong): SongDTO {
  const dto: SongDTO = {
    id: rawSong.id,
    title: rawSong.title || 'Unknown Title',
    artist: rawSong.artist || 'Unknown Artist',
    artistId: rawSong.artistId,
    album: rawSong.album || 'Unknown Album',
    albumId: rawSong.albumId,
    durationFormatted: formatDuration(rawSong.duration),
    addedDate: rawSong.createdAt || new Date().toISOString(),
  };

  // Add optional fields only if they have values
  const genre = extractGenre(rawSong);
  if (genre !== undefined) {
    dto.genre = genre;
  }

  const genres = extractAllGenres(rawSong);
  if (genres !== undefined) {
    dto.genres = genres;
  }

  if (rawSong.year !== undefined) {
    dto.year = rawSong.year;
  }

  if (rawSong.path !== undefined) {
    dto.path = rawSong.path as string;
  }

  if (rawSong.trackNumber !== undefined) {
    dto.trackNumber = rawSong.trackNumber;
  }

  if (rawSong.playCount !== undefined) {
    dto.playCount = rawSong.playCount;
  }

  if (rawSong.rating !== undefined) {
    dto.rating = rawSong.rating;
  }

  if (rawSong.starred !== undefined) {
    dto.starred = rawSong.starred;
  }

  return dto;
}

// Keep old function name for backward compatibility
export const transformToRecentlyAddedSongDTO = transformToSongDTO;

/**
 * Transform an array of raw songs to DTOs
 * @param rawSongs Array of raw song data
 * @returns Array of clean song DTOs
 */
export function transformSongsToDTO(rawSongs: unknown): SongDTO[] {
  if (!Array.isArray(rawSongs)) {
    return [];
  }

  return rawSongs.map((song) => transformToSongDTO(song as RawSong));
}

export function transformToAlbumDTO(rawAlbum: RawAlbum): AlbumDTO {
  const dto: AlbumDTO = {
    id: rawAlbum.id,
    name: rawAlbum.name || 'Unknown Album',
    artist: rawAlbum.artist || 'Unknown Artist',
    artistId: rawAlbum.artistId,
    songCount: rawAlbum.songCount || 0,
    durationFormatted: formatDuration(rawAlbum.duration),
  };

  if (rawAlbum.albumArtist !== undefined) {
    dto.albumArtist = rawAlbum.albumArtist;
  }

  if (rawAlbum.albumArtistId !== undefined) {
    dto.albumArtistId = rawAlbum.albumArtistId;
  }

  if (rawAlbum.releaseYear !== undefined) {
    dto.releaseYear = rawAlbum.releaseYear;
  }

  const genre = extractGenre(rawAlbum as unknown as RawSong);
  if (genre !== undefined) {
    dto.genre = genre;
  }

  const genres = extractAllGenres(rawAlbum as unknown as RawSong);
  if (genres !== undefined) {
    dto.genres = genres;
  }

  if (rawAlbum.compilation !== undefined) {
    dto.compilation = rawAlbum.compilation;
  }

  if (rawAlbum.playCount !== undefined) {
    dto.playCount = rawAlbum.playCount;
  }

  if (rawAlbum.rating !== undefined) {
    dto.rating = rawAlbum.rating;
  }

  if (rawAlbum.starred !== undefined) {
    dto.starred = rawAlbum.starred;
  }

  return dto;
}

export function transformAlbumsToDTO(rawAlbums: unknown): AlbumDTO[] {
  if (!Array.isArray(rawAlbums)) {
    return [];
  }

  return rawAlbums.map((album) => transformToAlbumDTO(album as RawAlbum));
}

export function transformToArtistDTO(rawArtist: RawArtist): ArtistDTO {
  const dto: ArtistDTO = {
    id: rawArtist.id,
    name: rawArtist.name || 'Unknown Artist',
    albumCount: rawArtist.albumCount || 0,
    songCount: rawArtist.songCount || 0,
  };

  if (rawArtist.genres !== undefined) {
    dto.genres = rawArtist.genres;
  }

  if (rawArtist.biography !== undefined) {
    dto.biography = rawArtist.biography;
  }

  if (rawArtist.playCount !== undefined) {
    dto.playCount = rawArtist.playCount;
  }

  if (rawArtist.rating !== undefined) {
    dto.rating = rawArtist.rating;
  }

  if (rawArtist.starred !== undefined) {
    dto.starred = rawArtist.starred;
  }

  return dto;
}

export function transformArtistsToDTO(rawArtists: unknown): ArtistDTO[] {
  if (!Array.isArray(rawArtists)) {
    return [];
  }

  return rawArtists.map((artist) => transformToArtistDTO(artist as RawArtist));
}

export function transformToGenreDTO(rawGenre: RawGenre): GenreDTO {
  return {
    id: rawGenre.id,
    name: rawGenre.name || 'Unknown Genre',
    songCount: rawGenre.songCount || 0,
    albumCount: rawGenre.albumCount || 0,
  };
}

export function transformGenresToDTO(rawGenres: unknown): GenreDTO[] {
  if (!Array.isArray(rawGenres)) {
    return [];
  }

  return rawGenres.map((genre) => transformToGenreDTO(genre as RawGenre));
}

export function transformToPlaylistDTO(rawPlaylist: RawPlaylist): PlaylistDTO {
  const dto: PlaylistDTO = {
    id: rawPlaylist.id,
    name: rawPlaylist.name || 'Unknown Playlist',
    public: rawPlaylist.public || false,
    songCount: rawPlaylist.songCount || 0,
    durationFormatted: formatDuration(rawPlaylist.duration),
    owner: rawPlaylist.owner || 'Unknown Owner',
  };

  if (rawPlaylist.comment !== undefined) {
    dto.comment = rawPlaylist.comment;
  }

  return dto;
}

export function transformPlaylistsToDTO(rawPlaylists: unknown): PlaylistDTO[] {
  if (!Array.isArray(rawPlaylists)) {
    return [];
  }

  return rawPlaylists.map((playlist) => transformToPlaylistDTO(playlist as RawPlaylist));
}