/**
 * Navidrome MCP Server - normalize-title unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The cases are the real-world title variants that docs/ARTIST-ALBUMS-SPEC.md section 5 names.
 */

import { describe, expect, it } from 'vitest';
import { normTitle, isJunkAlbumName } from '../../../src/utils/normalize-title.js';

describe('normTitle', () => {
  const cases: Array<[input: string, expected: string]> = [
    ['Dark All Day', 'dark all day'],
    ['The Midnight', 'midnight'],
    ['Café del Mar', 'cafe del mar'],
    ['Röyksopp', 'royksopp'],
    ['Dark All Day [Explicit]', 'dark all day'],
    ['Unicorn (Deluxe Edition)', 'unicorn'],
    ['GUNSHIP (Instrumentals)', 'gunship'],
    ['Tech Noir (Carpenter Brut Remix)', 'tech noir'],
    ['Sunset (2020 Remaster)', 'sunset'],
    ['Early Summer (Bonus Track Version)', 'early summer'],
    ['66 MHz - Single', '66 mhz'],
    ['Accelerated - EP', 'accelerated'],
    // A dashless format word is part of the title.
    ['Foo EP', 'foo ep'],
    // Source tags, bracketed or trailing
    ['GUNSHIP WEB', 'gunship'],
    ['GUNSHIP (WEB)', 'gunship'],
    ['GUNSHIP [CDM]', 'gunship'],
    ['GUNSHIP CDS', 'gunship'],
    // Symbol-only titles keep the symbols as the key
    ['÷', '÷'],
    ['+', '+'],
    ['÷ (Deluxe)', '÷'],
    ['', ''],
    ["Miami Nights '84", 'miami nights 84'],
    ['Art3mis & Parzival', 'art3mis parzival'],
    ['GUNSHIP: Instrumentals', 'gunship instrumentals'],
    ['  Turbulence  ', 'turbulence'],
  ];

  it.each(cases)('normTitle(%j) === %j', (input, expected) => {
    expect(normTitle(input)).toBe(expected);
  });

  it('collapses variant duplicates onto the same key', () => {
    expect(normTitle('Dark All Day [Explicit]')).toBe(normTitle('Dark All Day'));
    expect(normTitle('UNICORN (Deluxe Edition)')).toBe(normTitle('Unicorn'));
    expect(normTitle('GUNSHIP WEB')).toBe(normTitle('GUNSHIP'));
  });

  it('keeps genuinely different titles apart', () => {
    expect(normTitle('Dark All Day')).not.toBe(normTitle('GUNSHIP'));
    expect(normTitle('Turbulence')).not.toBe(normTitle('Early Summer'));
    expect(normTitle('÷')).not.toBe(normTitle('×'));
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
    // Variant dupes are not junk. They dedup via normTitle instead.
    'Dark All Day [Explicit]',
    'GUNSHIP WEB',
    // Contains "com" but not as a domain suffix.
    'Coming Home',
    // "tribute" and "mixtape" appear here only inside a longer word, so these are real albums.
    'Attribute',
    'Contribute',
    'The Attributes of God',
    'Mixtapes & Memories',
  ];

  it.each(legit)('passes %j through', name => {
    expect(isJunkAlbumName(name)).toBe(false);
  });
});
