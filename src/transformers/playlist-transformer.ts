/**
 * Navidrome MCP Server - Playlist Data Transformers
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PlaylistDTO, PlaylistTrackDTO } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  extractGenre,
  formatDuration,
  shouldEmit,
  transformObjectRows,
  type TransformOptions,
} from './shared-transformers.js';

/** Older Navidrome releases emit the owner as `owner` instead of `ownerName`. */
export interface RawPlaylist {
  id: string;
  name: string;
  comment?: string;
  public: boolean;
  songCount: number;
  duration?: number;
  owner?: string;
  ownerName?: string;
  ownerId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

interface RawPlaylistTrack {
  id: string;
  mediaFileId?: string;
  playlistId: string;
  title?: string;
  album?: string;
  artist?: string;
  albumArtist?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  trackNumber?: number;
  year?: number;
  genre?: string;
  genres?: Array<{ name: string }>;
  [key: string]: unknown;
}

export function transformToPlaylistDTO(rawPlaylist: RawPlaylist, options?: TransformOptions): PlaylistDTO {
  const owner = rawPlaylist.ownerName ?? rawPlaylist.owner ?? '';

  const dto: PlaylistDTO = {
    id: rawPlaylist.id,
    name: rawPlaylist.name || '',
    public: rawPlaylist.public || false,
    songCount: rawPlaylist.songCount || 0,
    durationFormatted: formatDuration(rawPlaylist.duration),
    owner,
  };

  if (shouldEmit('duration', options) && rawPlaylist.duration !== undefined) {
    dto.duration = rawPlaylist.duration;
  }

  if (rawPlaylist.ownerId !== undefined && rawPlaylist.ownerId !== '') {
    dto.ownerId = rawPlaylist.ownerId;
  }

  if (rawPlaylist.comment !== undefined && rawPlaylist.comment !== '') {
    dto.comment = rawPlaylist.comment;
  }

  if (rawPlaylist.createdAt !== undefined && rawPlaylist.createdAt !== '') {
    dto.createdAt = rawPlaylist.createdAt;
  }

  if (rawPlaylist.updatedAt !== undefined && rawPlaylist.updatedAt !== '') {
    dto.updatedAt = rawPlaylist.updatedAt;
  }

  return dto;
}

export function transformPlaylistsToDTO(rawPlaylists: unknown, options?: TransformOptions): PlaylistDTO[] {
  return transformObjectRows(rawPlaylists, (playlist: RawPlaylist) => transformToPlaylistDTO(playlist, options));
}

/**
 * Compact output keeps only what identifies and acts on a track (`position` for reorder and
 * remove, `songId` for playback), so large playlists stay under the token cap.
 */
export function transformToPlaylistTrackDTO(rawTrack: RawPlaylistTrack, options?: TransformOptions): PlaylistTrackDTO {
  const mediaFileId = rawTrack.mediaFileId ?? '';
  const hasMediaFileId = mediaFileId !== '';
  const songId = hasMediaFileId ? mediaFileId : rawTrack.id;

  // The fallback is a playlist position, not a song id, so a later lookup by it names no song.
  // The warning keeps that substitution visible in the logs.
  if (!hasMediaFileId) {
    logger.warn(
      `Playlist track missing mediaFileId (playlistId=${rawTrack.playlistId}, position=${rawTrack.id}); ` +
        `using playlist-position id as a fallback. Possible Navidrome API contract violation.`
    );
  }

  const dto: PlaylistTrackDTO = {
    position: rawTrack.id,
    songId,
    title: rawTrack.title ?? '',
    album: rawTrack.album ?? '',
    artist: rawTrack.artist ?? '',
    durationFormatted: formatDuration(rawTrack.duration),
  };

  if (shouldEmit('playlistId', options)) {
    dto.playlistId = rawTrack.playlistId;
  }

  if (shouldEmit('duration', options) && rawTrack.duration !== undefined) {
    dto.duration = rawTrack.duration;
  }

  if (shouldEmit('albumArtist', options) && rawTrack.albumArtist !== undefined && rawTrack.albumArtist !== '') {
    dto.albumArtist = rawTrack.albumArtist;
  }

  if (shouldEmit('bitRate', options) && rawTrack.bitRate !== undefined) {
    dto.bitRate = rawTrack.bitRate;
  }

  if (shouldEmit('path', options) && rawTrack.path !== undefined && rawTrack.path !== '') {
    dto.path = rawTrack.path;
  }

  if (shouldEmit('trackNumber', options) && rawTrack.trackNumber !== undefined) {
    dto.trackNumber = rawTrack.trackNumber;
  }

  if (shouldEmit('year', options) && rawTrack.year !== undefined && rawTrack.year > 0) {
    dto.year = rawTrack.year;
  }

  if (shouldEmit('genre', options)) {
    const genre = extractGenre(rawTrack);
    if (genre !== undefined) {
      dto.genre = genre;
    }
  }

  return dto;
}

export function transformPlaylistTracksToDTO(rawTracks: unknown, options?: TransformOptions): PlaylistTrackDTO[] {
  return transformObjectRows(rawTracks, (track: RawPlaylistTrack) => transformToPlaylistTrackDTO(track, options));
}
