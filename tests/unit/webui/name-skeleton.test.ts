/**
 * Navidrome MCP Server - Jukebox name skeleton test
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'vitest';
import { nameSkeleton } from '../../../src/webui/auth/name-skeleton.js';

describe('nameSkeleton', () => {
  it.each([
    ['letter case', 'HOST'],
    ['an accent', 'Hóst'],
    ['a trailing combining mark', 'Host͏'],
    ['a Cyrillic o', 'Hоst'],
    ['Cyrillic capitals', 'НОЅТ'],
    ['Greek capitals', 'ΗΟST'],
    ['fullwidth letters', 'Ｈｏｓｔ'],
    ['separators between the letters', 'H.o-s_t!'],
    ['a zero for the o', 'H0st'],
    ['an accent on a zero', 'H0́st'],
    ['small capitals', 'ʜᴏꜱᴛ'],
    ['a lowercase Cyrillic en, which reads as a small capital', 'нost'],
    ['a lowercase Cyrillic te', 'Hosт'],
    ['a Greek tau', 'Hоsτ'],
    ['a Greek final sigma', 'Ηοςτ'],
    ['Cherokee capitals', 'ᎻᎾᏚᎢ'],
    ['Cherokee small letters', 'ꮋꮎꮪꭲ'],
    ['a trailing Hangul filler, which shows nothing', 'Hostㅤ'],
    ['a variation selector after Cherokee letters', 'ᎻᎾᏚᎢ️'],
    ['a combining grapheme joiner after a Cherokee letter', 'Ꮋ͏ᎾᏚᎢ'],
  ])('reads %s as the same name', (_label, name) => {
    expect(nameSkeleton(name)).toBe(nameSkeleton('Host'));
  });

  it.each([
    ['another word', 'Hosta'],
    ['a script with no Latin lookalike', 'Хозяин'],
  ])('keeps %s apart from Host', (_label, name) => {
    expect(nameSkeleton(name)).not.toBe(nameSkeleton('Host'));
  });

  it.each([
    ['Devanagari vowel signs', 'कमल', 'कोमल'],
    ['another Devanagari vowel sign', 'कमल', 'किमल'],
    ['a Japanese voicing mark', 'か', 'が'],
    ['Arabic vowel marks', 'سَلم', 'سُلم'],
  ])('keeps names that differ by %s apart', (_label, name, other) => {
    expect(nameSkeleton(other)).not.toBe(nameSkeleton(name));
  });

  it('keeps names of separators alone apart', () => {
    expect(nameSkeleton('!!')).not.toBe(nameSkeleton('...'));
  });

  it.each([
    ['Ali', 'AIi'],
    ['Mike', 'MIKE'],
    ['ivan', 'Ivan'],
    ['Lily', 'LILY'],
  ])('reads %s and %s as one name, since i, I and l fold into one letter', (name, other) => {
    expect(nameSkeleton(other)).toBe(nameSkeleton(name));
  });
});
