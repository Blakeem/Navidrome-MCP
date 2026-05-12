/**
 * Navidrome MCP Server - tags tool tests
 * Copyright (C) 2025
 *
 * Covers searchByTags and getTagDistribution from src/tools/tags.ts.
 * Both are reads, but they use requestWithLibraryFilter / requestWithLibraryFilterAndMeta
 * which are mockable — mocked approach keeps tests fast and deterministic.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { searchByTags, getTagDistribution } from '../../../src/tools/tags.js';
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

// ---- searchByTags -----------------------------------------------------------

describe('searchByTags', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('returns matches array + total on happy path', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag(), makeTag({ id: 'tag-002', tagValue: 'Pop', songCount: 80 })],
      total: 2,
    });

    const result = await searchByTags(mockClient as unknown as NavidromeClient, {
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

  it('sorts matches by songCount descending', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [
        makeTag({ id: 'low', tagValue: 'Blues', songCount: 10 }),
        makeTag({ id: 'high', tagValue: 'Rock', songCount: 500 }),
        makeTag({ id: 'mid', tagValue: 'Jazz', songCount: 100 }),
      ],
      total: 3,
    });

    const result = await searchByTags(mockClient as unknown as NavidromeClient, { tagName: 'genre' });

    expect(result.matches[0]!.songCount).toBeGreaterThanOrEqual(result.matches[1]!.songCount);
    expect(result.matches[1]!.songCount).toBeGreaterThanOrEqual(result.matches[2]!.songCount);
  });

  it('includes tag_name in the request URL', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await searchByTags(mockClient as unknown as NavidromeClient, { tagName: 'mood' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('tag_name=mood');
  });

  it('includes tag_value when specified', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });

    await searchByTags(mockClient as unknown as NavidromeClient, { tagName: 'genre', tagValue: 'Rock' });

    const [endpoint] = mockClient.requestWithLibraryFilterAndMeta.mock.calls[0]!;
    expect(endpoint).toContain('tag_value=Rock');
  });

  it('falls back to items.length when total is null', async () => {
    mockClient.requestWithLibraryFilterAndMeta.mockResolvedValue({
      data: [makeTag()],
      total: null,
    });

    const result = await searchByTags(mockClient as unknown as NavidromeClient, { tagName: 'genre' });

    expect(result.total).toBe(1);
  });

  it('throws when tagName is missing (Zod validation)', async () => {
    await expect(
      searchByTags(mockClient as unknown as NavidromeClient, {})
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
    // requestWithLibraryFilter returns arrays of tags for each tag name
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      makeTag({ tagName: 'genre', tagValue: 'Rock', songCount: 200, albumCount: 20 }),
      makeTag({ id: 'g2', tagName: 'genre', tagValue: 'Pop', songCount: 100, albumCount: 10 }),
    ]);

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
    mockClient.requestWithLibraryFilter
      .mockResolvedValueOnce([])   // 'genre' returned nothing
      .mockResolvedValueOnce([makeTag({ tagName: 'mood', tagValue: 'Happy', songCount: 50, albumCount: 5 })]);

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre', 'mood'],
    });

    // 'genre' is skipped, 'mood' is included
    const genreDist = result.distributions.find(d => d.tagName === 'genre');
    expect(genreDist).toBeUndefined();
  });

  it('skips tag names that throw (e.g., 404 from Navidrome)', async () => {
    mockClient.requestWithLibraryFilter.mockRejectedValue(new Error('404 not found'));

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['nonexistent_tag'],
    });

    // Should return gracefully with empty distributions
    expect(Array.isArray(result.distributions)).toBe(true);
    expect(result.distributions).toHaveLength(0);
  });

  it('uses distributionLimit to cap the distribution array', async () => {
    const tags = Array.from({ length: 20 }, (_, i) => makeTag({
      id: `t-${i}`,
      tagValue: `Val${i}`,
      songCount: 100 - i,
    }));
    mockClient.requestWithLibraryFilter.mockResolvedValue(tags);

    const result = await getTagDistribution(mockClient as unknown as NavidromeClient, {
      tagNames: ['genre'],
      distributionLimit: 5,
    });

    // Mock provides 20 tags; one distribution entry must come back.
    expect(result.distributions).toHaveLength(1);
    expect(result.distributions[0]!.distribution.length).toBe(5);
  });
});
