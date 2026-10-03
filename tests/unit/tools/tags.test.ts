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

    expect(result.total).toBe(2);
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches).toHaveLength(2);

    const first = result.matches[0]!;
    expect(typeof first.id).toBe('string');
    expect(typeof first.tagName).toBe('string');
    expect(typeof first.tagValue).toBe('string');
    expect(typeof first.albumCount).toBe('number');
    expect(typeof first.songCount).toBe('number');
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
    expect(result.matches.map(tag => tag.id)).toEqual(['high', 'mid']);
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

  it('returns distributions array + totalTagNames', async () => {
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
    expect(result.totalTagNames).toBe(1);

    const dist = result.distributions[0]!;
    expect(dist.tagName).toBe('genre');
    expect(dist.uniqueValues).toBe(2);
    expect(dist.totalSongs).toBe(300);
    expect(dist.totalAlbums).toBe(30);
    expect(dist.mostCommon.tagValue).toBe('Rock');
    expect(Array.isArray(dist.distribution)).toBe(true);
    expect(dist.distribution.length).toBe(2);
  });

  it('skips tag names that return empty arrays', async () => {
    // Route by endpoint: genre /tag empty, mood /tag returns one value, and
    // mood (non-genre) backfill /album + /song calls resolve to total 0.
    mockClient.requestWithLibraryFilterAndMeta.mockImplementation((endpoint) => {
      if (endpoint.includes('tag_name=genre')) return Promise.resolve({ data: [], total: 0 });
      if (endpoint.includes('tag_name=mood')) {
        return Promise.resolve({
          data: [makeTag({ tagName: 'mood', tagValue: 'Happy', songCount: 50, albumCount: 5 })],
          total: 1,
        });
      }
      return Promise.resolve({ data: [], total: 0 }); // backfill /album, /song
    });

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre', 'mood'],
    });

    // 'genre' is skipped, 'mood' is included
    const genreDist = result.distributions.find(d => d.tagName === 'genre');
    expect(genreDist).toBeUndefined();
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

  it('flags non-genre distributions as sampled and leaves genre unflagged', async () => {
    // genre → true top-N (server sorts by count) ⇒ unflagged.
    // mood → alphabetical sample ⇒ sampled: true. mood rows here carry counts,
    // so no backfill sub-requests are triggered.
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
    expect(moodDist?.sampled).toBe(true);
  });
});
