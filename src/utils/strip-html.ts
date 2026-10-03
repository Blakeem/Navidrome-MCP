/**
 * Navidrome MCP Server - HTML stripping helper
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
 * Out-of-range and surrogate code points would make String.fromCodePoint throw or
 * emit a lone surrogate, so those entities pass through as written.
 */
function decodeCodePoint(codePoint: number, original: string): string {
  const isValid =
    Number.isFinite(codePoint) && codePoint > 0 && codePoint < 0x110000 && !(codePoint >= 0xd800 && codePoint <= 0xdfff);
  return isValid ? String.fromCodePoint(codePoint) : original;
}

/**
 * Removes tags (a br tag becomes a space), decodes the common named and numeric
 * entities, collapses whitespace and trims. Not XSS protection for a browser context.
 */
export function stripHtml(input: string): string {
  if (input === '') return input;

  // Strip tags, replacing <br>/<br/>/<BR> variants with a single space so
  // adjacent words don't merge ("requires<BR>Winamp" → "requires Winamp").
  // Other tags are dropped without inserting whitespace (typical inline
  // <a>/<b>/<i> wrappers).
  const tagPattern = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let stripped = input.replace(tagPattern, (_match, tagName: string) => {
    return /^br$/i.test(tagName) ? ' ' : '';
  });

  // Decode the entities that actually appear in ICY notice fields in the wild.
  // Numeric entities are decoded best-effort. Malformed sequences pass through.
  stripped = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (match, hex: string) => decodeCodePoint(Number.parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, code: string) => decodeCodePoint(Number.parseInt(code, 10), match));

  return stripped.replace(/\s+/g, ' ').trim();
}
