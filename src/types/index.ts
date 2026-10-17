/**
 * Navidrome MCP Server - Data Transfer Objects
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type {
  SongDTO,
  AlbumDTO,
  ArtistDTO
} from './core.js';

export type {
  PlaylistDTO,
  PlaylistTrackDTO,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddTracksToPlaylistRequest,
  AddTracksToPlaylistResponse,
  RemoveTracksFromPlaylistResponse,
  ReorderPlaylistTrackRequest,
  ReorderPlaylistTrackResponse
} from './playlists.js';

export type {
  RadioStationDTO,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
  ExternalRadioStationDTO,
  DiscoverRadioStationsResponse,
  RadioFiltersResponse,
  ClickRadioStationResponse,
  VoteRadioStationResponse,
  StreamValidationResult
} from './radio.js';

export type {
  TagDTO,
  TagDistribution,
  TagDistributionResponse
} from './tags.js';

export type {
  LyricsLine,
  LyricsDTO,
  LyricsCandidateDTO,
  LyricsSearchDTO
} from './lyrics.js';

export type {
  LibraryDTO,
  UserDetailsDTO,
  LibraryManagementResponse,
} from './library.js';