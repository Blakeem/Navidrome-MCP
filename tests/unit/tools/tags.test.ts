/**
 * Navidrome MCP Server - tags tool tests
 * Copyright (C) 2025
 *
 * Covers listTagValues and getTagDistribution from src/tools/tags.ts.
 * Both are reads, but they use requestWithLibraryFilter / requestWithLibraryFilterAndMeta
 * which are mockable — mocked approach keeps tests fast and deterministic.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { listTagValues, getTagDistribution } from '../../../src/tools/tags.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

function makeTag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'tag-uuid-001',
    tagName: 'genre',
    tagValue: 'Rock',
    albumCount: 10,
    songCount: 150,
    ...overrides,
  };
}

// ---- listTagValues -----------------------------------------------------------

describe('listTagValues', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns matches array + total on happy path', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag(), makeTag({ id: 'tag-002', tagValue: 'Pop', songCount: 80 })],
      total: 2,
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, {
      tagName: 'genre',
    });

    expect(result.tagName).toBe('genre');
    expect(result.total).toBe(2);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches).toHaveLength(2);

    const first = result.matches[0]!;
    expect(Object.keys(first).sort()).toEqual(['albumCount', 'songCount', 'tagValue']);
    expect(typeof first.tagValue).toBe('string');
    expect(typeof first.albumCount).toBe('number');
    expect(typeof first.songCount).toBe('number');
    expect(result.countsIncomplete).toBeUndefined();
  });

  it('backfills non-genre counts by the row id, which matches every casing of the value', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.startsWith('/tag')) {
        return Promise.resolve({
          data: [{ id: 'mood-row-1', tagName: 'mood', tagValue: 'Happy' }],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 7 });
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'mood' });

    const endpoints = mockClient.requestWithLibraryFilterAndMeta.mock.calls.map(([endpoint]) => endpoint);
    expect(endpoints).toContain('/album?_start=0&_end=1&mood=mood-row-1');
    expect(endpoints).toContain('/song?_start=0&_end=1&mood=mood-row-1');
    expect(result.matches[0]).toEqual({ tagValue: 'Happy', albumCount: 7, songCount: 7 });
  });

  it('backfills album and song counts from their own X-Total-Count under the lowercased tag name', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.startsWith('/tag?')) {
        return Promise.resolve({ data: [{ id: 'rt-1', tagName: 'releasetype', tagValue: 'EP' }], total: 1 });
      }
      if (endpoint.startsWith('/album?')) return Promise.resolve({ data: [], total: 7 });
      return Promise.resolve({ data: [], total: 42 });
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'releasetype' });

    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith('/album?_start=0&_end=1&releasetype=rt-1');
    expect(mockClient.requestWithLibraryFilterAndMeta).toHaveBeenCalledWith('/song?_start=0&_end=1&releasetype=rt-1');
    expect(result.matches[0]).toMatchObject({ albumCount: 7, songCount: 42 });
  });

  it('keeps both counts at 0 when only the song backfill fails', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.startsWith('/tag?')) {
        return Promise.resolve({ data: [{ id: 'rt-1', tagName: 'releasetype', tagValue: 'EP' }], total: 1 });
      }
      if (endpoint.startsWith('/song?')) return Promise.reject(new Error('503'));
      return Promise.resolve({ data: [], total: 7 });
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'releasetype' });

    expect(result.matches[0]).toMatchObject({ albumCount: 0, songCount: 0 });
  });

  it('flags countsIncomplete when a backfill request fails', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.startsWith('/tag')) {
        return Promise.resolve({
          data: [{ id: 'mood-row-1', tagName: 'mood', tagValue: 'Happy' }],
          total: 1,
        });
      }
      return Promise.reject(new Error('timeout'));
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'mood' });

    expect(result.countsIncomplete).toBe(true);
    expect(result.matches[0]?.songCount).toBe(0);
  });

  it('drops a null /tag row instead of failing the whole call', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [null, makeTag()],
      total: 2,
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'genre' });

    expect(result.matches.map(tag => tag.tagValue)).toEqual(['Rock']);
  });

  it('sorts a tagName given in any casing as genre', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'Genre' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('_sort=songCount');
    expect(endpoint).toContain('tag_name=genre');
    expect(result.tagName).toBe('genre');
  });

  it('pages genre by songCount DESC on the server and keeps the server order', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [
        makeTag({ id: 'high', tagValue: 'Rock', songCount: 500 }),
        makeTag({ id: 'mid', tagValue: 'Jazz', songCount: 100 }),
      ],
      total: 2,
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'genre' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('_sort=songCount');
    expect(endpoint).toContain('_order=DESC');
    expect(result.matches.map(tag => tag.tagValue)).toEqual(['Rock', 'Jazz']);
  });

  it('pages non-genre tag names alphabetically, since only genre rows carry counts', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'recordlabel' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('_sort=tagValue');
    expect(endpoint).toContain('_order=ASC');
  });

  it('includes tag_name in the request URL', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'mood' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('tag_name=mood');
  });

  it('includes tag_value when specified', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'genre', tagValue: 'Rock' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('tag_value=Rock');
  });

  it('falls back to items.length when total is null', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag()],
      total: null,
    });

    const result = await listTagValues(mockClient as unknown as NavidromeClient, { tagName: 'genre' });

    expect(result.total).toBe(1);
  });

  it('throws when tagName is missing (Zod validation)', async () => {
    await expect(
      listTagValues(mockClient as unknown as NavidromeClient, {})
    ).rejects.toThrow();
  });
});

// ---- getTagDistribution -----------------------------------------------------

describe('getTagDistribution', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns the distributions array', async () => {
    // The /tag fetch now goes through ...AndMeta; X-Total-Count (total) feeds
    // uniqueValues. genre carries API counts, so no backfill calls are made.
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [
        makeTag({ tagName: 'genre', tagValue: 'Rock', songCount: 200, albumCount: 20 }),
        makeTag({ id: 'g2', tagName: 'genre', tagValue: 'Pop', songCount: 100, albumCount: 10 }),
      ],
      total: 2,
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre'],
    });

    // Mock returns 2 genre tags, so distributions should contain exactly one
    // entry (one tag name, two values). Asserting unconditionally — a
    // regression that returned empty would silently pass under the old
    // `if (length > 0)` guard.
    expect(result.distributions).toHaveLength(1);

    const dist = result.distributions[0]!;
    expect(dist.tagName).toBe('genre');
    expect(dist.uniqueValues).toBe(2);
    expect(dist.totalSongs).toBe(300);
    expect(dist.totalAlbums).toBe(30);
    expect(dist.distribution[0]?.tagValue).toBe('Rock');
    expect(dist).not.toHaveProperty('mostCommon');
    expect(Array.isArray(dist.distribution)).toBe(true);
    expect(dist.distribution.length).toBe(2);
  });

  it('skips tag names that return empty arrays', async () => {
    // Route by endpoint: genre /tag empty, mood /tag returns one value that carries counts.
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.includes('tag_name=genre')) return Promise.resolve({ data: [], total: 0 });
      if (endpoint.includes('tag_name=mood')) {
        return Promise.resolve({
          data: [makeTag({ tagName: 'mood', tagValue: 'Happy', songCount: 50, albumCount: 5 })],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre', 'mood'],
    });

    expect(result.distributions.map((d) => d.tagName)).toEqual(['mood']);
    expect(result.emptyTagNames).toEqual(['genre']);
  });

  it('throws a tool error when a /tag request fails instead of reporting an empty library', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockRejectedValue(new Error('503 Service Unavailable'));

    await expect(getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre'],
    })).rejects.toThrow(/get_tag_distribution.*503/s);
  });

  it('uses distributionLimit to cap the distribution array', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => makeTag({
      id: `t-${i}`,
      tagValue: `Val${i}`,
      songCount: 100 - i,
    }));
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      const end = Number(new URLSearchParams(endpoint.split('?')[1]).get('_end'));
      return Promise.resolve({ data: tags.slice(0, end), total: 20 });
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre'],
      distributionLimit: 5,
    });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('_end=5');
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0]!.distribution.length).toBe(5);
    expect(result.distributions[0]!.uniqueValues).toBe(20);
  });

  it('requests genre distribution sorted by songCount DESC (true top-N, not alphabetical)', async () => {
    // genre is the one tag name with server-provided counts, so the fetch must
    // ask Navidrome for the top values by count rather than an alphabetical slice.
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag({ tagName: 'genre', tagValue: 'Rock', songCount: 200, albumCount: 20 })],
      total: 1,
    });

    await getTagDistribution(mockClient as unknown as NavidromeClient, { tagNames: ['genre'] });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('_sort=songCount');
    expect(endpoint).toContain('_order=DESC');
  });

  it('leaves genre and a complete non-genre distribution unflagged', async () => {
    // mood rows here carry counts, so no backfill sub-requests are triggered.
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.includes('tag_name=genre')) {
        return Promise.resolve({
          data: [makeTag({ tagName: 'genre', tagValue: 'Rock', songCount: 200, albumCount: 20 })],
          total: 1,
        });
      }
      if (endpoint.includes('tag_name=mood')) {
        return Promise.resolve({
          data: [makeTag({ tagName: 'mood', tagValue: 'Happy', songCount: 50, albumCount: 5 })],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 });
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre', 'mood'],
    });

    const genreDist = result.distributions.find(d => d.tagName === 'genre');
    const moodDist = result.distributions.find(d => d.tagName === 'mood');
    expect(genreDist?.sampled).toBeUndefined();
    expect(moodDist?.sampled).toBeUndefined();
  });

  it('flags a non-genre distribution as sampled when the tag name has more values than the page', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag({ tagName: 'mood', tagValue: 'Happy', songCount: 50, albumCount: 5 })],
      total: 40,
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, { tagNames: ['mood'] });

    expect(result.distributions[0]?.sampled).toBe(true);
  });

  it('flags countsIncomplete on the distribution whose backfill failed', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.includes('tag_name=genre')) {
        return Promise.resolve({ data: [makeTag()], total: 1 });
      }
      if (endpoint.includes('tag_name=mood')) {
        return Promise.resolve({ data: [{ id: 'mood-row-1', tagName: 'mood', tagValue: 'Happy' }], total: 1 });
      }
      return Promise.reject(new Error('timeout'));
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre', 'mood'],
    });

    expect(result.distributions.find(d => d.tagName === 'genre')?.countsIncomplete).toBeUndefined();
    expect(result.distributions.find(d => d.tagName === 'mood')?.countsIncomplete).toBe(true);
  });

  it('bounds backfill requests across every tag name of one call', async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation(async (endpoint) => {
      if (endpoint.startsWith('/tag')) {
        const tagName = new URLSearchParams(endpoint.split('?')[1]).get('tag_name') ?? '';
        const rows = Array.from({ length: 10 }, (_, i) => ({ id: `${tagName}-${i}`, tagName, tagValue: `V${i}` }));
        return { data: rows, total: 10 };
      }
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { data: [], total: 1 };
    });

    await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['mood', 'media', 'releasetype'],
    });

    // Eight entries per chunk, two requests per entry.
    expect(peakInFlight).toBeLessThanOrEqual(16);
  });

  it('lowercases requested tag names', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await getTagDistribution(mockClient as unknown as NavidromeClient, { tagNames: ['Genre'] });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('tag_name=genre');
    expect(endpoint).toContain('_sort=songCount');
  });
});
