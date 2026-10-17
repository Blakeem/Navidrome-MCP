/**
 * Navidrome MCP Server - Title normalization for cross-source album matching
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * A lossy join key for one release across MusicBrainz, Last.fm and Navidrome, such as "Dark All Day
 * [Explicit]" and "dark all day".
 */

// Bracketed noise that labels and scrapers append. search_lyrics also matches song titles through
// normTitle, so a change here must suit song titles too.
const NOISE_GROUP =
  /[([](?:[^)\]]*\b(?:explicit|clean|deluxe|expanded|remaster(?:ed)?|anniversary|edition|bonus|instrumentals?|remix(?:es)?|version|web|cdm|cds|feat\.?[^)\]]*)\b[^)\]]*)[)\]]/gi;

// Format suffixes such as "Foo - Single" and "Foo - EP".
const TRAILING_FORMAT = /\s*[-–]\s*(?:single|ep)\s*$/i;

// Unbracketed source tags, such as "Foo WEB" and "Foo CDM".
const TRAILING_SOURCE = /\s+(?:web|cdm|cds)\s*$/i;

export function normTitle(s: string): string {
  let out = s.toLowerCase();

  out = out.normalize('NFD').replace(/\p{M}/gu, '');

  out = out.replace(NOISE_GROUP, ' ');
  out = out.replace(TRAILING_FORMAT, ' ');
  out = out.replace(TRAILING_SOURCE, ' ');
  const denoised = out;

  out = out.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  // Symbol-only titles ("÷", "+") would otherwise all share the empty key.
  if (out === '') {
    return denoised.replace(/\s+/gu, '');
  }

  out = out.replace(/^the\s+/, '');

  return out;
}

// Placeholder names Last.fm serves in getTopAlbums.
const JUNK_EXACT = /^(?:null|<unknown>|\[non-album tracks\])$/i;

// Scrobble-scraper and bootleg artifacts. Word bounds on tribute and mixtape keep real titles
// such as "Attribute" and "Contribute".
const JUNK_CONTAINS =
  /uploaded by|\.(?:com|cc)\b|blogspot|youtube|\bmixtape\b|vk\.com|playback ?fm|\btribute\b|compilation tape/i;

/**
 * Scrobble junk must never reach the MCP response (docs/ARTIST-ALBUMS-SPEC.md §5). A variant such
 * as "Foo [Explicit]" is not junk, since the normTitle-keyed dedup collapses it.
 */
export function isJunkAlbumName(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === '') return true;
  return JUNK_EXACT.test(trimmed) || JUNK_CONTAINS.test(trimmed);
}
