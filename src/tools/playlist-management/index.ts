/**
 * Navidrome MCP Server - Playlist Management Tools
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

// Export CRUD operations
export {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
} from './playlist-crud.js';

// Export track management operations
export {
  addTracksToPlaylist,
  batchAddTracksToPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistTrack,
} from './track-management.js';

// Export playlist export functionality
export {
  getPlaylistTracks,
} from './playlist-export.js';