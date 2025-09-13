/**
 * Navidrome MCP Server - Transformers Index
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

// Re-export all transformer functions and types for backward compatibility

// Shared utilities
export { formatDuration, extractGenre, extractAllGenres } from './shared-transformers.js';
export type { RawEntityWithGenres } from './shared-transformers.js';

// Song transformers
export { transformToSongDTO, transformSongsToDTO } from './song-transformer.js';
export type { RawSong } from './song-transformer.js';

// Album transformers
export { transformToAlbumDTO, transformAlbumsToDTO } from './album-transformer.js';
export type { RawAlbum } from './album-transformer.js';

// Artist transformers
export { transformToArtistDTO, transformArtistsToDTO } from './artist-transformer.js';
export type { RawArtist } from './artist-transformer.js';

// Playlist transformers
export { transformToPlaylistDTO, transformPlaylistsToDTO } from './playlist-transformer.js';
export type { RawPlaylist } from './playlist-transformer.js';