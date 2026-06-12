/**
 * Navidrome MCP Server - normalize-title unit tests
 * Copyright (C) 2025
 *
 * Covers the title normalizer + junk filter used to join album titles across
 * MusicBrainz, Last.fm, and Navidrome (get_artist_albums). Table-driven over
 * the in-the-wild variants the spec calls out (docs/ARTIST-ALBUMS-SPEC.md §5).
 */

import { describe, expect, it } from 'vitest';
import { normTitle, isJunkAlbumName } from '../../../src/utils/normalize-title.js';

describe('normTitle', () => {
  const cases: Array<[input: string, expected: string]> = [
    // Plain
    ['Dark All Day', 'dark all day'],
    // Case + leading "the"
    ['The Midnight', 'midnight'],
    // Diacritics
    ['Café del Mar', 'cafe del mar'],
    ['Röyksopp', 'royksopp'],
    // Bracketed noise
    ['Dark All Day [Explicit]', 'dark all day'],
    ['Unicorn (Deluxe Edition)', 'unicorn'],
    ['GUNSHIP (Instrumentals)', 'gunship'],
    ['Tech Noir (Carpenter Brut Remix)', 'tech noir'],
    ['Sunset (2020 Remaster)', 'sunset'],
    ['Early Summer (Bonus Track Version)', 'early summer'],
    // Trailing format suffixes
    ['66 MHz - Single', '66 mhz'],
    ['Accelerated - EP', 'accelerated'],
    // Punctuation collapse
    ["Miami Nights '84", 'miami nights 84'],
    ['Art3mis & Parzival', 'art3mis parzival'],
    ['GUNSHIP: Instrumentals', 'gunship instrumentals'],
    // Whitespace
    ['  Turbulence  ', 'turbulence'],
  ];

  it.each(cases)('normTitle(%j) === %j', (input, expected) => {
    expect(normTitle(input)).toBe(expected);
  });

  it('collapses variant duplicates onto the same key', () => {
    expect(normTitle('Dark All Day [Explicit]')).toBe(normTitle('Dark All Day'));
    expect(normTitle('UNICORN (Deluxe Edition)')).toBe(normTitle('Unicorn'));
  });

  it('keeps genuinely different titles apart', () => {
    expect(normTitle('Dark All Day')).not.toBe(normTitle('GUNSHIP'));
    expect(normTitle('Turbulence')).not.toBe(normTitle('Early Summer'));
  });
});

describe('isJunkAlbumName', () => {
  const junk = [
    'null',
    'NULL',
    '<unknown>',
    '[non-album tracks]',
    'uploaded by SynthFan99',
    'www.synthwave-downloads.com',
    'best-of.cc',
    'myblog.blogspot.de',
    'ripped from YouTube',
    'Summer Mixtape 2019',
    'vk.com/retrowave',
    'Playback FM',
    'playbackfm vol 2',
    'A Tribute to GUNSHIP',
    'compilation tape #4',
    '',
    '   ',
  ];

  it.each(junk)('flags %j as junk', name => {
    expect(isJunkAlbumName(name)).toBe(true);
  });

  const legit = [
    'Dark All Day',
    'GUNSHIP',
    'Unicorn',
    "Miami Nights '84",
    'Turbulence',
    // Variant dupes are NOT junk — they dedup via normTitle instead.
    'Dark All Day [Explicit]',
    'GUNSHIP WEB',
    // Contains "com" but not as a domain suffix.
    'Coming Home',
    // Contain "tribute"/"mixtape" only as a word fragment — must NOT be dropped
    // (regression: substring match silently discarded real albums).
    'Attribute',
    'Contribute',
    'The Attributes of God',
    'Mixtapes & Memories',
  ];

  it.each(legit)('passes %j through', name => {
    expect(isJunkAlbumName(name)).toBe(false);
  });
});
