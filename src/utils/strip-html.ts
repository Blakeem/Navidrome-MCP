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
 * Strip HTML tags and decode the common HTML entities from a free-form text
 * fragment. Intended for short, low-trust strings — ICY metadata headers,
 * station "notice" fields, etc. — that some Icecast/SHOUTcast servers ship
 * with embedded markup like `<BR>` or `<a href="...">...</a>`.
 *
 * Not a general-purpose HTML parser: this is a single-pass tag stripper with
 * minimal entity decoding. It's safe to feed into JSON destined for an LLM
 * (no nested-tag DOS, no script-execution concerns — we're not rendering),
 * but do not rely on it as XSS protection in a browser context.
 *
 * Returns the input unchanged if it contains no tags / entities, so it's
 * cheap to call on every header value.
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
  // Numeric entities are decoded best-effort; malformed sequences pass through.
  stripped = stripped
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => {
      const n = Number.parseInt(code, 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : _match;
    });

  // Collapse runs of whitespace produced by tag/entity removal.
  return stripped.replace(/\s+/g, ' ').trim();
}
