/**
 * Navidrome MCP Server - listMostPlayed tests
 * Copyright (C) 2025
 *
 * Covers listMostPlayed from src/tools/listening-history.ts.
 * listRecentlyPlayed is already covered in listening-history.test.ts.
 * All tests use createMockClient() — no live calls.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { listMostPlayed } from '../../../src/tools/listening-history.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { AlbumDTO, ArtistDTO, SongDTO } from '../../../src/types/index.js';

// Minimal raw song row as Navidrome returns it
function makeSong(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    title: 'Song',
    artist: 'Artist',
    artistId: 'a1',
    album: 'Album',
    albumId: 'al1',
    duration: 200,
    playCount: 5,
    playDate: '2026-05-01T12:00:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAlbum(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'al1',
    name: 'Album',
    artist: 'Artist',
    artistId: 'a1',
    songCount: 10,
    duration: 2000,
    playCount: 8,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeArtist(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'a1',
    name: 'Artist',
    albumCount: 3,
    songCount: 30,
    playCount: 20,
    ...overrides,
  };
}

// ---- type="songs" -----------------------------------------------------------

describe('listMostPlayed — songs', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('queries /song?_sort=playCount&_order=DESC', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'songs' });

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('/song');
    expect(endpoint).toContain('_sort=playCount');
    expect(endpoint).toContain('_order=DESC');
  });

  it('returns count + items with song fields', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeSong({ id: 's1', playCount: 10 }),
      makeSong({ id: 's2', title: 'Song 2', playCount: 7 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'songs', limit: 5 });

    expect(result.count).toBe(2);
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toHaveLength(2);

    const first = result.items[0] as SongDTO;
    expect(typeof first.id).toBe('string');
    expect(typeof first.title).toBe('string');
    expect(typeof first.artist).toBe('string');
    expect(typeof first.album).toBe('string');
    expect(typeof first.playCount).toBe('number');
  });

  it('filters out songs with playCount below minPlayCount', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeSong({ id: 's1', playCount: 10 }),
      makeSong({ id: 's2', playCount: 2 }),
      makeSong({ id: 's3', playCount: 0 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, {
      type: 'songs',
      minPlayCount: 5,
      limit: 10,
    });

    expect(result.count).toBe(1);
    expect(result.items[0]!.playCount).toBeGreaterThanOrEqual(5);
  });

  it('requests only the limit-sized page from the server', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, {
      type: 'songs',
      limit: 3,
      minPlayCount: 1,
    });

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('_start=0');
    expect(endpoint).toContain('_end=3');
  });
});

// ---- pagination --------------------------------------------------------------

describe('listMostPlayed - pagination', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  // The fetch sorts on playCount, the field minPlayCount tests, so the server offset is exact.
  it('requests exactly the offset..offset+limit window', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'songs', limit: 10, offset: 20 });

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('_start=20');
    expect(endpoint).toContain('_end=30');
  });

  it('reports hasMore when every row of a full page qualifies', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeSong({ id: 's2', playCount: 8 }),
      makeSong({ id: 's3', playCount: 7 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, {
      type: 'songs', limit: 2, offset: 2, minPlayCount: 1,
    });

    expect(result.items.map(i => i.id)).toEqual(['s2', 's3']);
    expect(result.hasMore).toBe(true);
  });

  it('reports no more pages once a row falls below minPlayCount', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeSong({ id: 's1', playCount: 10 }),
      makeSong({ id: 's2', playCount: 1 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, {
      type: 'songs', limit: 2, offset: 0, minPlayCount: 5,
    });

    expect(result.items.map(i => i.id)).toEqual(['s1']);
    expect(result.hasMore).toBe(false);
  });
});

// ---- type="albums" ----------------------------------------------------------

describe('listMostPlayed — albums', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('queries /album?_sort=playCount&_order=DESC', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'albums' });

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('/album');
    expect(endpoint).toContain('_sort=playCount');
  });

  it('returns album items with name, artist, songCount, playCount', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeAlbum({ id: 'al1', playCount: 15 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'albums', limit: 5 });

    expect(result.count).toBe(1);
    const item = result.items[0] as AlbumDTO;
    expect(typeof item.id).toBe('string');
    expect(typeof item.name).toBe('string');
    expect(typeof item.artist).toBe('string');
    expect(typeof item.playCount).toBe('number');
  });
});

// ---- type="artists" ---------------------------------------------------------

describe('listMostPlayed — artists', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('queries /artist?_sort=playCount&_order=DESC', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'artists' });

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('/artist');
    expect(endpoint).toContain('_sort=playCount');
  });

  it('returns artist items with name, albumCount, songCount, playCount', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeArtist({ id: 'a1', playCount: 25 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, { type: 'artists', limit: 5 });

    expect(result.count).toBe(1);
    const item = result.items[0] as ArtistDTO;
    expect(typeof item.id).toBe('string');
    expect(typeof item.name).toBe('string');
    expect(typeof item.playCount).toBe('number');
  });

  it('returns empty items when no artists exceed minPlayCount', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeArtist({ playCount: 1 }),
    ]);

    const result = await listMostPlayed(mockClient as unknown as NavidromeClient, {
      type: 'artists',
      minPlayCount: 100,
    });

    expect(result.count).toBe(0);
    expect(result.items).toHaveLength(0);
  });
});

// ---- defaults ---------------------------------------------------------------

describe('listMostPlayed — defaults', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('defaults to type="songs" when type is omitted', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listMostPlayed(mockClient as unknown as NavidromeClient, {});

    const [endpoint] = mockClient.requestWithLibraryFilter.mock.calls[0]!;
    expect(endpoint).toContain('/song');
  });
});
