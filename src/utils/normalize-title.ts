/**
 * Navidrome MCP Server - Title normalization for cross-source album matching
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

/**
 * Shared normalization for joining album titles across MusicBrainz, Last.fm,
 * and Navidrome, where the same release appears with cosmetic variations:
 * "Dark All Day [Explicit]", "Dark All Day (Deluxe Edition)", "dark all day".
 *
 * The output is a join key, not a display string. It is intentionally lossy.
 * search_lyrics also keys song titles with normTitle, so check a NOISE_GROUP change against that match.
 */

// Bracketed/suffix noise that labels and scrapers append to the same release.
const NOISE_GROUP =
  /[([](?:[^)\]]*\b(?:explicit|clean|deluxe|expanded|remaster(?:ed)?|anniversary|edition|bonus|instrumentals?|remix(?:es)?|version|web|cdm|cds|feat\.?[^)\]]*)\b[^)\]]*)[)\]]/gi;

// Trailing release-format suffixes: "Foo - Single", "Foo - EP".
const TRAILING_FORMAT = /\s*[-–]\s*(?:single|ep)\s*$/i;

// Unbracketed trailing source tags: "Foo WEB", "Foo CDM".
const TRAILING_SOURCE = /\s+(?:web|cdm|cds)\s*$/i;

/** Normalize an album (or artist) title to a join key. */
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

// Whole-name junk: placeholder rows Last.fm serves in getTopAlbums.
const JUNK_EXACT = /^(?:null|<unknown>|\[non-album tracks\])$/i;

// Substring junk: scrobble-scraper artifacts, bootleg/tribute noise.
// `tribute`/`mixtape` are word-bounded so real titles containing them as a
// fragment ("Attribute", "Contribute") are not silently dropped.
const JUNK_CONTAINS =
  /uploaded by|\.(?:com|cc)\b|blogspot|youtube|\bmixtape\b|vk\.com|playback ?fm|\btribute\b|compilation tape/i;

/**
 * True when a Last.fm album name is scrobble junk that must never reach the
 * MCP response (docs/ARTIST-ALBUMS-SPEC.md §5). Variant duplicates ("Foo [Explicit]",
 * "Foo WEB") are not junk. They collapse via normTitle-keyed dedup instead.
 */
export function isJunkAlbumName(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === '') return true;
  return JUNK_EXACT.test(trimmed) || JUNK_CONTAINS.test(trimmed);
}
