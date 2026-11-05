/**
 * Navidrome MCP Server - stripHtml unit tests
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * stripHtml only cleans stream-header text such as ICY notices, so the cases follow real headers
 * instead of full HTML parsing.
 */

import { describe, expect, it } from 'vitest';
import { stripHtml } from '../../../src/utils/strip-html.js';

describe('stripHtml', () => {
  it('passes plain text through unchanged', () => {
    expect(stripHtml('Plain text without tags')).toBe('Plain text without tags');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('strips a simple <BR> tag and inserts a space so adjacent words do not merge', () => {
    expect(stripHtml('Before<BR>After')).toBe('Before After');
  });

  it('strips lowercase, uppercase, and self-closing <br/> variants', () => {
    expect(stripHtml('A<br>B<BR>C<br/>D<BR/>E')).toBe('A B C D E');
  });

  it('strips anchor tags but keeps the link text — the canonical ICY-notice case', () => {
    const input = '<BR>This stream requires <a href="http://www.winamp.com">Winamp</a><BR>';
    expect(stripHtml(input)).toBe('This stream requires Winamp');
  });

  it('strips nested inline tags', () => {
    expect(stripHtml('<b>Bold <i>and italic</i></b>')).toBe('Bold and italic');
  });

  it('decodes the common HTML entities', () => {
    expect(stripHtml('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(stripHtml('&quot;quoted&quot;')).toBe('"quoted"');
    expect(stripHtml('&lt;tag&gt;')).toBe('<tag>');
    expect(stripHtml('don&#39;t')).toBe("don't");
    expect(stripHtml('&apos;a&apos;')).toBe("'a'");
    expect(stripHtml('one&nbsp;two')).toBe('one two');
  });

  it('decodes numeric entities', () => {
    expect(stripHtml('&#65;&#66;&#67;')).toBe('ABC');
  });

  it('leaves malformed numeric entities alone', () => {
    expect(stripHtml('&#99999999999999999;')).toBe('&#99999999999999999;');
  });

  it('collapses runs of whitespace introduced by tag stripping', () => {
    expect(stripHtml('Hello<BR><BR><BR>World')).toBe('Hello World');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  <BR>middle<BR>  ')).toBe('middle');
  });

  it('handles a SHOUTcast-style server banner with mixed entities and tags', () => {
    const input = 'SHOUTcast Distributed Network Audio Server/Linux v1.9.5<BR>Visit <a href="http://shoutcast.com">shoutcast.com</a>';
    expect(stripHtml(input)).toBe('SHOUTcast Distributed Network Audio Server/Linux v1.9.5 Visit shoutcast.com');
  });

  it('preserves text content even when the tag has odd whitespace and attributes', () => {
    expect(stripHtml('<a  href = "x" >link</a >')).toBe('link');
  });
});
