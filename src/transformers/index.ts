/**
 * Navidrome MCP Server - Transformers Index
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Callers import shared-transformers.js directly, since re-exports here that nobody imports
// would fail the dead-code check.

export { transformToSongDTO, transformSongsToDTO } from './song-transformer.js';
export type { RawSong } from './song-transformer.js';

export { transformToAlbumDTO, transformAlbumsToDTO } from './album-transformer.js';
export type { RawAlbum } from './album-transformer.js';

export { transformToArtistDTO, transformArtistsToDTO } from './artist-transformer.js';
export type { RawArtist } from './artist-transformer.js';

export {
  transformToPlaylistDTO,
  transformPlaylistsToDTO,
  transformToPlaylistTrackDTO,
  transformPlaylistTracksToDTO,
} from './playlist-transformer.js';
export type { RawPlaylist } from './playlist-transformer.js';

export { transformTagsToMeta } from './tag-transformer.js';
export type { TagWithMeta } from './tag-transformer.js';
