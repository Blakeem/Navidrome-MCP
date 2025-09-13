/**
 * Navidrome MCP Server - Data Transfer Objects
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

// Export all core library DTOs
export type {
  SongDTO,
  AlbumDTO,
  ArtistDTO
} from './core.js';

// Export all playlist DTOs
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

// Export all radio DTOs
export type {
  RadioStationDTO,
  CreateRadioStationRequest,
  CreateRadioStationResponse,
  DeleteRadioStationResponse,
  ListRadioStationsResponse,
  RadioPlaybackInfo,
  ExternalRadioStationDTO,
  DiscoverRadioStationsResponse,
  RadioFiltersResponse,
  ClickRadioStationResponse,
  VoteRadioStationResponse
} from './radio.js';

// Export all tag DTOs
export type {
  TagDTO,
  TagDistribution,
  TagDistributionResponse
} from './tags.js';

// Export all lyrics DTOs
export type {
  LyricsLine,
  LyricsDTO
} from './lyrics.js';

// Export all library DTOs
export type {
  LibraryDTO,
  UserDetailsDTO,
  LibraryManagementResponse,
  SetActiveLibrariesRequest
} from './library.js';