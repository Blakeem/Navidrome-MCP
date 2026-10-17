/**
 * Navidrome MCP Server - HTML stripping helper
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
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

/** Stream header values pass through this for the LLM. It is not XSS protection for a browser. */
export function stripHtml(input: string): string {
  if (input === '') return input;

  // A br becomes a space so adjacent words stay apart, such as "requires<BR>Winamp".
  const tagPattern = /<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let stripped = input.replace(tagPattern, (_match, tagName: string) => {
    return /^br$/i.test(tagName) ? ' ' : '';
  });

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
