/**
 * Navidrome MCP Server - Jukebox name skeleton
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Each key is a Latin letter and its value the Cyrillic, Greek, small capital and Cherokee characters that read as it.
// They match before case folding, since В reads as B while в does not, and every i folds into l, since I reads as l.
const LOOKALIKES_BY_LETTER: Readonly<Record<string, string>> = {
  a: 'АаΑαᴀᎪꭺ',
  b: 'ВΒʙᏴᏼ',
  c: 'СсᴄᏟꮯ',
  d: 'ԁᴅᎠꭰ',
  e: 'ЕеΕᴇᎬꭼ',
  g: 'ɢᏀꮐ',
  h: 'НнҺһΗʜᎻꮋ',
  j: 'ЈјᴊᎫꭻ',
  k: 'КΚᴋᏦꮶ',
  l: '1IiіІӀӏΙιɪʟᏞꮮ',
  m: 'МΜᴍᎷꮇ',
  n: 'Νɴ',
  o: '0ОоΟοᴏᎾꮎ',
  p: 'РрΡρᴘᏢꮲ',
  q: 'Ԛԛ',
  r: 'ʀᎡꭱ',
  s: 'ЅѕςꜱᏚꮪ',
  t: 'ТΤтτᴛᎢꭲ',
  u: 'υᴜ',
  v: 'νᴠᏙꮩ',
  w: 'ԜԝᴡᎳꮃᏔꮤ',
  x: 'ХхΧχ',
  y: 'УуΥʏᎩꭹ',
  z: 'ΖᴢᏃꮓ',
};

const LOOKALIKES = new Map<string, string>(
  Object.entries(LOOKALIKES_BY_LETTER).flatMap(([letter, chars]) => Array.from(chars, (char) => [char, letter] as const)),
);
// A mark on a Latin, Greek, Cyrillic, Cherokee or common character such as a digit is an accent, so `Hóst` reads as `Host`.
// The marks of other scripts are vowel signs and voicing marks that make another name, such as कमल and कोमल.
const ACCENT_MARK = /(?<=[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Cherokee}\p{Script=Common}])\p{M}+/gu;
// The nickname schema refuses invisible characters. A name stored before that rule may still hold one.
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/gu;
const SEPARATOR = /[\s.,'!?_-]/gu;

/**
 * Two names with one skeleton read as the same name, such as `Host`, `H o s t`, `Hóst` and `Hоst` with a
 * Cyrillic о. A name of separators alone keeps them, so `!!` and `...` stay apart.
 */
export function nameSkeleton(name: string): string {
  const unmarked = name.normalize('NFKD').replace(INVISIBLE, '').replace(ACCENT_MARK, '');
  const letters = unmarked.replace(SEPARATOR, '');
  return Array.from(letters === '' ? unmarked : letters, (char) => LOOKALIKES.get(char) ?? char.toLowerCase()).join('');
}
