/**
 * Navidrome MCP Server - Lyrics Resolver Tests
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
 * Covers the source-selectable lyrics resolver: the deduplicated LRCLIB retry
 * ladder, the local file source, line end times, and source precedence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { createMockClient } from '../../factories/mock-client.js';
import { getLyrics, parseLocalLyrics, LAST_LINE_FALLBACK_MS } from '../../../src/tools/lyrics.js';

const config = makeTestConfig({ lrclibUserAgent: 'TestAgent/1.0', lrclibBase: 'https://lrclib.net' });

function makeResponse(status: number, body: unknown, statusText = 'OK'): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function requestedUrls(): string[] {
  const mock = global.fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.map((call) => String(call[0]));
}

function localEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lang: 'eng',
    synced: true,
    line: [
      { start: 1000, value: 'Local line one which is comfortably long' },
      { start: 4000, value: 'Local line two' },
    ],
    ...overrides,
  };
}

// ============================================================================
// LRCLIB retry ladder
// ============================================================================

describe('LRCLIB retry ladder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('issues exactly one /api/get when only title and artist are supplied', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, []));

    const result = await getLyrics(config, { title: 'Ghost', artist: 'Nobody' });

    const urls = requestedUrls();
    expect(urls).toHaveLength(2);
    expect(urls.filter((url) => url.includes('/api/get'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/api/search'))).toHaveLength(1);
    expect(result.provider).toBe('lrclib');
    expect(result.hasSynced).toBe(false);
    expect(result.synced).toBeUndefined();
    expect(result.unsynced).toBeUndefined();
  });

  it('fires four distinct rungs in order when album and duration are present', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, []));

    await getLyrics(config, { title: 'Track', artist: 'Band', album: 'Record', durationMs: 200_000 });

    const urls = requestedUrls();
    expect(urls).toHaveLength(4);

    expect(urls[0]).toContain('/api/get');
    expect(urls[0]).toContain('album_name=Record');
    expect(urls[0]).toContain('duration=200');

    expect(urls[1]).toContain('/api/get');
    expect(urls[1]).toContain('album_name=Record');
    expect(urls[1]).not.toContain('duration=');

    expect(urls[2]).toContain('/api/get');
    expect(urls[2]).not.toContain('album_name');

    expect(urls[3]).toContain('/api/search');
    expect(urls[3]).toContain('track_name=Track');
    expect(urls[3]).toContain('artist_name=Band');
    expect(urls[3]).not.toContain('query=');
    expect(urls[3]).not.toContain('duration=');
  });

  it('looks a known record id up as a path segment before the metadata rungs', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, { syncedLyrics: '[00:03.00]From metadata' }));

    const result = await getLyrics(config, { title: 'Track', artist: 'Band', id: '3396226' });

    const urls = requestedUrls();
    expect(urls[0]).toContain('/api/get/3396226');
    expect(urls[0]).not.toContain('id=');
    expect(urls[1]).toContain('track_name=Track');
    expect(result.hasSynced).toBe(true);
  });

  it('falls through a 404 to the next rung', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, { syncedLyrics: '[00:02.00]Later' }));

    const result = await getLyrics(config, {
      title: 'Track', artist: 'Band', album: 'Record', durationMs: 200_000,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.hasSynced).toBe(true);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 2000, text: 'Later' });
  });

  it('throws on a 5xx from the first rung without trying the second', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(makeResponse(503, null, 'Service Unavailable'));

    await expect(
      getLyrics(config, { title: 'Track', artist: 'Band', album: 'Record', durationMs: 200_000 })
    ).rejects.toThrow();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps a plain-only rung as fallback and stops at the first synced rung', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(200, { plainLyrics: 'plain from rung one' }))
      .mockResolvedValueOnce(makeResponse(200, {
        syncedLyrics: '[00:01.00]Timed line',
        plainLyrics: 'plain from rung two',
      }));

    const result = await getLyrics(config, {
      title: 'Track', artist: 'Band', album: 'Record', durationMs: 200_000,
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.hasSynced).toBe(true);
    expect(result.synced?.[0]?.text).toBe('Timed line');
    expect(result.unsynced).toBe('plain from rung two');
  });

  it('returns the retained plain result when no rung has synced lyrics', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(200, { plainLyrics: 'plain only' }))
      .mockResolvedValueOnce(makeResponse(200, {}))
      .mockResolvedValueOnce(makeResponse(200, {}))
      .mockResolvedValueOnce(makeResponse(200, []));

    const result = await getLyrics(config, {
      title: 'Track', artist: 'Band', album: 'Record', durationMs: 200_000,
    });

    expect(result.hasSynced).toBe(false);
    expect(result.unsynced).toBe('plain only');
    expect(result.provider).toBe('lrclib');
  });
});

// ============================================================================
// Line end times
// ============================================================================

describe('LyricsLine endMs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('takes endMs from the following marker', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]One\n[00:03.50]Two' })
    );

    const result = await getLyrics(config, { title: 'T', artist: 'A' });

    expect(result.synced).toHaveLength(2);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, endMs: 3500, text: 'One' });
  });

  it('takes endMs from a trailing empty marker and does not emit that marker', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]One\n[00:04.00]', duration: 300 })
    );

    const result = await getLyrics(config, { title: 'T', artist: 'A' });

    expect(result.synced).toHaveLength(1);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, endMs: 4000, text: 'One' });
  });

  it('falls back to the track duration for the final line', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]Only line', duration: 300 })
    );

    const result = await getLyrics(config, { title: 'T', artist: 'A' });

    expect(result.synced).toHaveLength(1);
    expect(result.synced?.[0]?.endMs).toBe(300_000);
  });

  it('falls back to LAST_LINE_FALLBACK_MS when no marker and no duration bound the final line', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]Only line' })
    );

    const result = await getLyrics(config, { title: 'T', artist: 'A' });

    expect(result.synced).toHaveLength(1);
    expect(result.synced?.[0]?.endMs).toBe(1000 + LAST_LINE_FALLBACK_MS);
  });

  it('still parses grouped timestamps and gives each its own end time', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00] [00:05.00]Chorus' })
    );

    const result = await getLyrics(config, { title: 'T', artist: 'A' });

    expect(result.synced).toHaveLength(2);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, endMs: 5000, text: 'Chorus' });
    expect(result.synced?.[1]).toMatchObject({ timeMs: 5000, endMs: 5000 + LAST_LINE_FALLBACK_MS });
  });
});

// ============================================================================
// Local file source
// ============================================================================

describe('local file lyrics source', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns local lyrics with zero LRCLIB requests when allowLrclib is false', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const client = createMockClient();
    client.requestWithLibraryFilter.mockResolvedValue({ lyrics: JSON.stringify([localEntry()]) });

    const result = await getLyrics(
      config,
      { title: 'T', artist: 'A' },
      { client: client as unknown as NavidromeClient, songId: 'song-1', allowLrclib: false }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.requestWithLibraryFilter).toHaveBeenCalledWith('/song/song-1');
    expect(result.provider).toBe('local');
    expect(result.hasSynced).toBe(true);
    expect(result.synced).toHaveLength(2);
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, endMs: 4000 });
  });

  it('does not look up local lyrics when no songId is supplied', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, []));
    const client = createMockClient();

    await getLyrics(config, { title: 'T', artist: 'A' }, { client: client as unknown as NavidromeClient });

    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('prefers local synced lyrics over LRCLIB and skips the ladder', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const client = createMockClient();
    client.requestWithLibraryFilter.mockResolvedValue({ lyrics: JSON.stringify([localEntry()]) });

    const result = await getLyrics(
      config,
      { title: 'T', artist: 'A' },
      { client: client as unknown as NavidromeClient, songId: 'song-1' }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.provider).toBe('local');
  });

  it('prefers LRCLIB synced lyrics over local plain lyrics', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]Remote timed' })
    );
    const client = createMockClient();
    client.requestWithLibraryFilter.mockResolvedValue({
      lyrics: JSON.stringify([
        localEntry({ synced: false, line: [{ value: 'A plain local line that is definitely long enough' }] }),
      ]),
    });

    const result = await getLyrics(
      config,
      { title: 'T', artist: 'A' },
      { client: client as unknown as NavidromeClient, songId: 'song-1' }
    );

    expect(result.provider).toBe('lrclib');
    expect(result.hasSynced).toBe(true);
  });

  it('falls back to local plain lyrics when LRCLIB has none', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(404, null, 'Not Found'))
      .mockResolvedValueOnce(makeResponse(200, []));
    const client = createMockClient();
    client.requestWithLibraryFilter.mockResolvedValue({
      lyrics: JSON.stringify([
        localEntry({ synced: false, line: [{ value: 'A plain local line that is definitely long enough' }] }),
      ]),
    });

    const result = await getLyrics(
      config,
      { title: 'T', artist: 'A' },
      { client: client as unknown as NavidromeClient, songId: 'song-1' }
    );

    expect(result.provider).toBe('local');
    expect(result.hasSynced).toBe(false);
    expect(result.unsynced).toBe('A plain local line that is definitely long enough');
  });

  it('falls through to LRCLIB when the song row fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, { syncedLyrics: '[00:01.00]Remote timed' })
    );
    const client = createMockClient();
    client.requestWithLibraryFilter.mockRejectedValue(new Error('Navidrome API error: 404 Not Found'));

    const result = await getLyrics(
      config,
      { title: 'T', artist: 'A' },
      { client: client as unknown as NavidromeClient, songId: 'song-1' }
    );

    expect(result.provider).toBe('lrclib');
    expect(result.hasSynced).toBe(true);
  });
});

// ============================================================================
// parseLocalLyrics
// ============================================================================

describe('parseLocalLyrics', () => {
  it('returns null for an empty lyrics array', () => {
    expect(parseLocalLyrics('[]')).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    expect(parseLocalLyrics('{not json at all')).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(parseLocalLyrics(null)).toBeNull();
    expect(parseLocalLyrics(undefined)).toBeNull();
  });

  it('returns null for a non-array payload', () => {
    expect(parseLocalLyrics('{"lang":"eng","synced":false}')).toBeNull();
    expect(parseLocalLyrics(42)).toBeNull();
  });

  it('prefers a synced entry over a plain entry with more lines', () => {
    const raw = JSON.stringify([
      {
        lang: 'eng',
        synced: false,
        line: [
          { value: 'plain one line here for sure' },
          { value: 'plain two' },
          { value: 'plain three' },
        ],
      },
      { lang: 'eng', synced: true, line: [{ start: 500, value: 'timed line that is definitely long enough here' }] },
    ]);

    const result = parseLocalLyrics(raw);

    expect(result?.hasSynced).toBe(true);
    expect(result?.synced?.[0]).toMatchObject({ timeMs: 500, text: 'timed line that is definitely long enough here' });
  });

  it('prefers a real language over xxx', () => {
    const raw = JSON.stringify([
      { lang: 'xxx', synced: true, line: [{ start: 0, value: 'unknown language line that is long enough here' }] },
      { lang: 'eng', synced: true, line: [{ start: 0, value: 'english language line that is long enough here' }] },
    ]);

    const result = parseLocalLyrics(raw);

    expect(result?.unsynced).toBe('english language line that is long enough here');
  });

  it('prefers the entry with the most lines when synced and language tie', () => {
    const raw = JSON.stringify([
      { lang: 'eng', synced: true, line: [{ start: 0, value: 'short entry line that is definitely long enough' }] },
      {
        lang: 'eng',
        synced: true,
        line: [
          { start: 0, value: 'long entry first' },
          { start: 1000, value: 'long entry second' },
        ],
      },
    ]);

    const result = parseLocalLyrics(raw);

    expect(result?.synced).toHaveLength(2);
  });

  it('discards a single-line entry under 40 characters as a tagger watermark', () => {
    const raw = JSON.stringify([{ lang: 'eng', synced: false, line: [{ value: 'Lyrics by SomeTagger' }] }]);

    expect(parseLocalLyrics(raw)).toBeNull();
  });

  it('uses the supplied duration for the final local line end time', () => {
    const raw = JSON.stringify([localEntry()]);

    const result = parseLocalLyrics(raw, 240_000);

    expect(result?.synced?.[1]?.endMs).toBe(240_000);
  });

  it('falls back to LAST_LINE_FALLBACK_MS for the final local line with no duration', () => {
    const raw = JSON.stringify([localEntry()]);

    const result = parseLocalLyrics(raw);

    expect(result?.synced?.[1]?.endMs).toBe(4000 + LAST_LINE_FALLBACK_MS);
  });

  it('accepts an already-parsed array payload', () => {
    const result = parseLocalLyrics([localEntry()]);

    expect(result?.hasSynced).toBe(true);
  });
});
