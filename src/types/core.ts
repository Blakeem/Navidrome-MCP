/**
 * Navidrome MCP Server - Core Library Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface SongDTO {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  albumArtist?: string;
  albumArtistId?: string;
  album: string;
  albumId: string;
  genre?: string;
  genres?: string[];
  year?: number;
  durationFormatted: string;
  /** Seconds. Verbose or `keep` only, since `durationFormatted` carries the same information. */
  duration?: number;
  /** ISO 8601 time the song was added to the library, from Navidrome's `createdAt`. */
  addedDate?: string;
  /** Relative to the library root. */
  path?: string;
  trackNumber?: number;
  playCount?: number;
  /** 1 to 5. Navidrome's 0, which means unrated, is omitted. */
  rating?: number;
  starred?: boolean;
  /** ISO 8601. Present only with `starred: true`. */
  starredAt?: string;
  /** ISO 8601 time of the user's last play. */
  playDate?: string;
  /** Lyrics in the audio file's own tag. Omitted when the file has none. Says nothing about
   *  LRCLIB availability. */
  lyrics?: 'synced' | 'unsynced';
}


export interface AlbumDTO {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  albumArtist?: string;
  albumArtistId?: string;
  releaseYear?: number;
  genre?: string;
  genres?: string[];
  songCount: number;
  durationFormatted: string;
  compilation?: boolean;
  playCount?: number;
  /** 1 to 5. Navidrome's 0, which means unrated, is omitted. */
  rating?: number;
  starred?: boolean;
  /** ISO 8601. Present only with `starred: true`. */
  starredAt?: string;
}

export interface ArtistDTO {
  id: string;
  name: string;
  albumCount: number;
  songCount: number;
  genres?: string[];
  biography?: string;
  playCount?: number;
  /** 1 to 5. Navidrome's 0, which means unrated, is omitted. */
  rating?: number;
  starred?: boolean;
  /** ISO 8601. Present only with `starred: true`. */
  starredAt?: string;
}


