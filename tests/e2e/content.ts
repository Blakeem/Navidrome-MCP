/**
 * Navidrome MCP Server - e2e library content
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Test code names only these two albums, which README.md names in its license section. Every other
 * song or album a test uses is picked without naming it.
 */

import type { AdminApi, LibrarySong } from './harness/admin-api.js';

export const ALLOWED_ARTIST = 'Nine Inch Nails';

export const ALLOWED_ALBUMS = {
  theSlip: 'The Slip',
  ghosts: 'Ghosts I–IV',
} as const;

export type AllowedAlbum = (typeof ALLOWED_ALBUMS)[keyof typeof ALLOWED_ALBUMS];

/** Throws with the album named when the library lacks it, so a missing album never reads as a product failure. */
export async function songsOf(api: AdminApi, album: AllowedAlbum): Promise<LibrarySong[]> {
  const albums = await api.searchAlbums(album);
  const match = albums.find((row) => row.name === album && row.artist === ALLOWED_ARTIST);
  if (match === undefined) {
    throw new Error(`e2e: the library has no album "${album}" by ${ALLOWED_ARTIST}. The e2e suite needs it.`);
  }
  const songs = await api.albumSongs(match.id);
  if (songs.length === 0) throw new Error(`e2e: the album "${album}" by ${ALLOWED_ARTIST} lists no songs.`);
  return songs;
}
