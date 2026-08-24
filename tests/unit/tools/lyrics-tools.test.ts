/**
 * Navidrome MCP Server - Lyrics Tool Surface Tests
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
 * Covers the split lyrics tool surface: get_lyrics by identity, search_lyrics
 * against LRCLIB, and the shape both take when LRCLIB is disabled.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { LyricsDTO, LyricsSearchDTO } from '../../../src/types/index.js';
import { makeTestConfig } from '../../helpers/test-config.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import { createLyricsToolCategory } from '../../../src/tools/handlers/lyrics-handlers.js';

const lrclibConfig = makeTestConfig({
  features: { lyrics: true },
  lrclibUserAgent: 'TestAgent/1.0',
  lrclibBase: 'https://lrclib.net',
});
const localOnlyConfig = makeTestConfig({ features: { lyrics: false } });

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

function syncedTag(): string {
  return JSON.stringify([
    {
      lang: 'eng',
      synced: true,
      line: [
        { start: 1000, value: 'Local line one which is comfortably long' },
        { start: 4000, value: 'Local line two' },
      ],
    },
  ]);
}

function songRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'song-1',
    title: 'Creep',
    artist: 'Radiohead',
    artistId: 'artist-1',
    album: 'Pablo Honey',
    albumId: 'album-1',
    duration: 238,
    ...overrides,
  };
}

function lrclibRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12345,
    trackName: 'Creep',
    artistName: 'Radiohead',
    albumName: 'Pablo Honey',
    duration: 238,
    instrumental: false,
    plainLyrics: 'When you were here before',
    syncedLyrics: '[00:01.00]When you were here before\n[00:04.00]I wish I was special',
    ...overrides,
  };
}

function makeCategory(config = lrclibConfig): {
  category: ReturnType<typeof createLyricsToolCategory>;
  client: MockNavidromeClient;
} {
  const client = createMockClient();
  return {
    category: createLyricsToolCategory(client as unknown as NavidromeClient, config),
    client,
  };
}

// ============================================================================
// get_lyrics — identity inputs
// ============================================================================

describe('get_lyrics identity inputs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('rejects a call with neither id, naming both fields', async () => {
    const { category } = makeCategory();

    await expect(category.handleToolCall('get_lyrics', {})).rejects.toThrow(/songId/);
    await expect(category.handleToolCall('get_lyrics', {})).rejects.toThrow(/lrclibId/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects the old metadata inputs', async () => {
    const { category, client } = makeCategory();

    await expect(
      category.handleToolCall('get_lyrics', { title: 'Creep', artist: 'Radiohead' }),
    ).rejects.toThrow();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('serves file lyrics from songId alone without touching LRCLIB', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilter.mockResolvedValue(songRow({ lyrics: syncedTag() }));

    const result = (await category.handleToolCall('get_lyrics', { songId: 'song-1' })) as LyricsDTO;

    expect(client.requestWithLibraryFilter).toHaveBeenCalledWith('/song/song-1');
    expect(result.provider).toBe('local');
    expect(result.hasSynced).toBe(true);
    expect(result.track).toMatchObject({ title: 'Creep', artist: 'Radiohead', durationMs: 238000 });
    expect(result.synced?.[0]).toMatchObject({ timeMs: 1000, endMs: 4000 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to LRCLIB using the metadata of the song row', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilter.mockResolvedValue(songRow());
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200, lrclibRecord()));

    const result = (await category.handleToolCall('get_lyrics', { songId: 'song-1' })) as LyricsDTO;

    const url = requestedUrls()[0] ?? '';
    expect(url).toContain('track_name=Creep');
    expect(url).toContain('artist_name=Radiohead');
    expect(url).toContain('album_name=Pablo+Honey');
    expect(url).toContain('duration=238');
    expect(result.provider).toBe('lrclib');
    expect(result.hasSynced).toBe(true);
  });

  it('fetches the named record from lrclibId alone', async () => {
    const { category, client } = makeCategory();
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200, lrclibRecord()));

    const result = (await category.handleToolCall('get_lyrics', {
      lrclibId: '12345',
    })) as LyricsDTO;

    expect(requestedUrls()).toEqual(['https://lrclib.net/api/get/12345']);
    expect(result.provider).toBe('lrclib');
    expect(result.hasSynced).toBe(true);
    expect(result.track).toMatchObject({ title: 'Creep', artist: 'Radiohead' });
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('reports an lrclibId that LRCLIB does not hold', async () => {
    const { category } = makeCategory();
    global.fetch = vi.fn().mockResolvedValue(makeResponse(404, null, 'Not Found'));

    await expect(category.handleToolCall('get_lyrics', { lrclibId: '999' })).rejects.toThrow(/999/);
  });

  it('propagates an LRCLIB 503 rather than reporting no lyrics', async () => {
    const { category } = makeCategory();
    global.fetch = vi.fn().mockResolvedValue(makeResponse(503, null, 'Service Unavailable'));

    await expect(category.handleToolCall('get_lyrics', { lrclibId: '12345' })).rejects.toThrow(
      /503/,
    );
  });
});

// ============================================================================
// search_lyrics — LRCLIB candidates plus the library match
// ============================================================================

describe('search_lyrics candidates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('returns ranked candidates carrying lrclibId and hasSynced', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
    global.fetch = vi.fn().mockResolvedValue(
      makeResponse(200, [
        lrclibRecord({ id: 777, trackName: 'Creepy Bootleg', syncedLyrics: undefined }),
        lrclibRecord({ id: 12345 }),
        lrclibRecord({ id: undefined }),
      ]),
    );

    const result = (await category.handleToolCall('search_lyrics', {
      title: 'Creep',
      artist: 'Radiohead',
    })) as LyricsSearchDTO;

    const url = requestedUrls()[0] ?? '';
    expect(url).toContain('/api/search');
    expect(url).toContain('track_name=Creep');
    // An id-less record cannot be fetched back, so it is not offered.
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual({
      lrclibId: '12345',
      trackName: 'Creep',
      artistName: 'Radiohead',
      albumName: 'Pablo Honey',
      durationMs: 238000,
      hasSynced: true,
    });
    expect(result.candidates[1]?.hasSynced).toBe(false);
    expect(result.librarySong).toBeUndefined();
  });

  it('reports the matching library song beside the candidates', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [songRow({ lyrics: syncedTag() })],
      total: 1,
    });
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200, [lrclibRecord()]));

    const result = (await category.handleToolCall('search_lyrics', {
      title: 'Creep',
      artist: 'Radiohead',
    })) as LyricsSearchDTO;

    expect(result.librarySong).toEqual({ songId: 'song-1', lyrics: 'synced' });
    expect(result.candidates).toHaveLength(1);
  });

  it('omits the library song when nothing in the library matches the artist', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [songRow({ artist: 'Someone Else' })],
      total: 1,
    });
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200, [lrclibRecord()]));

    const result = (await category.handleToolCall('search_lyrics', {
      title: 'Creep',
      artist: 'Radiohead',
    })) as LyricsSearchDTO;

    expect(result.librarySong).toBeUndefined();
  });

  it('still answers when the library lookup fails', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilterAndMeta.mockRejectedValue(new Error('Navidrome down'));
    global.fetch = vi.fn().mockResolvedValue(makeResponse(200, [lrclibRecord()]));

    const result = (await category.handleToolCall('search_lyrics', {
      title: 'Creep',
      artist: 'Radiohead',
    })) as LyricsSearchDTO;

    expect(result.candidates).toHaveLength(1);
    expect(result.librarySong).toBeUndefined();
  });

  it('propagates an LRCLIB 429 rather than reporting no candidates', async () => {
    const { category, client } = makeCategory();
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
    global.fetch = vi.fn().mockResolvedValue(makeResponse(429, null, 'Too Many Requests'));

    await expect(
      category.handleToolCall('search_lyrics', { title: 'Creep', artist: 'Radiohead' }),
    ).rejects.toThrow(/429/);
  });
});

// ============================================================================
// LRCLIB disabled — local file lyrics only
// ============================================================================

describe('lyrics category with LRCLIB disabled', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    global.fetch = vi.fn();
  });

  it('offers get_lyrics alone, with no lrclibId input and no LRCLIB in the text', () => {
    const { category } = makeCategory(localOnlyConfig);

    expect(category.tools.map((tool) => tool.name)).toEqual(['get_lyrics']);

    const tool = category.tools[0];
    const properties = tool?.inputSchema.properties ?? {};
    expect(Object.keys(properties)).toEqual(['songId']);
    expect(tool?.inputSchema.required).toEqual(['songId']);
    expect(JSON.stringify(tool)).not.toContain('LRCLIB');
  });

  it('serves file lyrics and never reaches LRCLIB', async () => {
    const { category, client } = makeCategory(localOnlyConfig);
    client.requestWithLibraryFilter.mockResolvedValue(songRow({ lyrics: syncedTag() }));

    const result = (await category.handleToolCall('get_lyrics', { songId: 'song-1' })) as LyricsDTO;

    expect(result.provider).toBe('local');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports an unusable songId instead of degrading to empty lyrics', async () => {
    const { category, client } = makeCategory(localOnlyConfig);
    client.requestWithLibraryFilter.mockResolvedValue(null);

    await expect(category.handleToolCall('get_lyrics', { songId: 'song-1' })).rejects.toThrow(
      /song-1/,
    );
  });

  it('refuses an lrclibId lookup', async () => {
    const { category } = makeCategory(localOnlyConfig);

    await expect(category.handleToolCall('get_lyrics', { lrclibId: '12345' })).rejects.toThrow(
      /lyricsProvider/,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('refuses a search_lyrics call', async () => {
    const { category } = makeCategory(localOnlyConfig);

    await expect(
      category.handleToolCall('search_lyrics', { title: 'Creep', artist: 'Radiohead' }),
    ).rejects.toThrow(/lyricsProvider/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
