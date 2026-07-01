/**
 * Navidrome MCP Server - listening-history tests
 * Copyright (C) 2025
 *
 * Verifies the v2.0.0 fix to list_recently_played: timeRange filtering is now
 * actually applied client-side (previously the param was accepted and ignored),
 * the sort key is `playDate` (not `addedDate`), and `lastPlayed` is populated
 * from the song's playDate field.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listRecentlyPlayed } from '../../../src/tools/listening-history.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

describe('listRecentlyPlayed', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries Navidrome with _sort=playDate (not addedDate)', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);
    await listRecentlyPlayed(mockClient as unknown as NavidromeClient, {});
    expect(mockClient.requestWithLibraryFilter).toHaveBeenCalledTimes(1);
    const endpoint = mockClient.requestWithLibraryFilter.mock.calls[0]![0];
    expect(endpoint).toContain('_sort=playDate');
    expect(endpoint).toContain('_order=DESC');
    expect(endpoint).not.toContain('addedDate');
  });

  it('returns lastPlayed from each song.playDate (verbose carries full metadata)', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      {
        id: 's1', title: 'Song1', artist: 'A', artistId: 'a',
        album: 'Al', albumId: 'al', duration: 200, playCount: 3,
        playDate: '2026-05-09T20:00:00Z', createdAt: '2025-01-01T00:00:00Z',
      },
    ]);

    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 5, verbose: true });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.lastPlayed).toBe('2026-05-09T20:00:00Z');
    expect(result.tracks[0]?.playCount).toBe(3);
  });

  it('compact (default) keeps lastPlayed but drops secondary fields like playCount/path', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      {
        id: 's1', title: 'Song1', artist: 'A', artistId: 'a',
        album: 'Al', albumId: 'al', duration: 200, playCount: 3,
        path: '/music/a/song1.flac',
        playDate: '2026-05-09T20:00:00Z', createdAt: '2025-01-01T00:00:00Z',
      },
    ]);

    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 5 });
    expect(result.tracks).toHaveLength(1);
    // playDate is force-kept (it is the tool's purpose), so lastPlayed survives.
    expect(result.tracks[0]?.lastPlayed).toBe('2026-05-09T20:00:00Z');
    // Secondary fields are dropped in compact mode to save context.
    expect(result.tracks[0]).not.toHaveProperty('playCount');
    expect(result.tracks[0]).not.toHaveProperty('path');
  });

  it('drops never-played songs (null/missing playDate sorts to the end)', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      { id: 's1', title: 'Played', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: '2026-05-09T20:00:00Z' },
      { id: 's2', title: 'NeverPlayed', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al' /* no playDate */ },
    ]);
    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 10 });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.id).toBe('s1');
  });

  it('timeRange="today" drops songs played before local midnight', async () => {
    // Freeze clock to a known instant: 2026-05-10T15:00:00 local time. We
    // build playDates with `new Date(year, month, day, ...)` (local-zone)
    // and then `.toISOString()` (UTC) so the test is timezone-agnostic:
    // the cutoff math compares absolute ms, so the local→UTC encoding here
    // is a no-op as long as we treat both `now` and the playDates in the
    // same zone. Don't change to UTC literals without re-checking this.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 10, 15, 0, 0));

    mockClient.requestWithLibraryFilter.mockResolvedValue([
      { id: 'today', title: 'T', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: new Date(2026, 4, 10, 9, 0, 0).toISOString() },
      { id: 'yesterday', title: 'Y', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: new Date(2026, 4, 9, 23, 30, 0).toISOString() },
    ]);

    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { timeRange: 'today', limit: 10 });
    expect(result.tracks.map(t => t.id)).toEqual(['today']);
  });

  it('timeRange="week" includes plays within last 7 days, excludes older', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-10T12:00:00Z');
    vi.setSystemTime(now);

    mockClient.requestWithLibraryFilter.mockResolvedValue([
      { id: 'recent', title: 'R', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: '2026-05-08T12:00:00Z' },
      { id: 'old', title: 'O', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: '2026-04-01T12:00:00Z' },
    ]);

    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { timeRange: 'week', limit: 10 });
    expect(result.tracks.map(t => t.id)).toEqual(['recent']);
  });

  it('timeRange="all" applies no time filter', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([
      { id: 'a', title: 'A', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: '2020-01-01T00:00:00Z' },
      { id: 'b', title: 'B', artist: 'A', artistId: 'a', album: 'Al', albumId: 'al', playDate: '2026-05-01T00:00:00Z' },
    ]);
    const result = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { timeRange: 'all', limit: 10 });
    expect(result.tracks).toHaveLength(2);
    // `timeRange` is no longer echoed (LLM input echo). The server-derived
    // `tracks` and `count` are what the LLM gets back.
    expect(result).not.toHaveProperty('timeRange');
  });

  it('over-fetches ((offset+limit)*5, capped at 500) when timeRange !== "all"', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 20, timeRange: 'today' });
    const filteredEndpoint = mockClient.requestWithLibraryFilter.mock.calls[0]![0];
    // offset 0, limit 20, timeRange filtering -> _end = 0 + (0+20)*5 = 100
    expect(filteredEndpoint).toContain('_end=100');

    mockClient.requestWithLibraryFilter.mockClear();
    await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 20, timeRange: 'all' });
    const allEndpoint = mockClient.requestWithLibraryFilter.mock.calls[0]![0];
    // timeRange=all -> exact limit, no over-fetch
    expect(allEndpoint).toContain('_end=20');
  });

  // Pagination-honesty regression: when a timeRange filter is active, the date
  // cutoff is applied client-side AFTER the fetch, so the server must NOT
  // pre-skip with _start=offset (that would permanently drop in-range rows in
  // global positions 0..offset-1). Instead we fetch from _start=0 and apply the
  // offset in memory after filtering.
  it('timeRange filter: fetches from _start=0 (not _start=offset) and applies offset client-side', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 10, offset: 20, timeRange: 'week' });

    const endpoint = mockClient.requestWithLibraryFilter.mock.calls[0]![0];
    // Must NOT pre-skip server-side: _start stays 0.
    expect(endpoint).toContain('_start=0');
    expect(endpoint).not.toContain('_start=20');
    // Over-fetch covers offset+limit: _end = 0 + (20+10)*5 = 150.
    expect(endpoint).toContain('_end=150');
  });

  it('timeRange filter: offset paginates the post-filter window (page 2 != page 1)', async () => {
    // Pin "now" just after the plays below so the `month` cutoff is deterministic
    // and doesn't rot as real-world time moves past the hardcoded dates.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 9, 12, 0, 1));
    // 5 in-range plays, newest first (the server returns them sorted playDate DESC).
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `s${i}`, title: `T${i}`, artist: 'A', artistId: 'a',
      album: 'Al', albumId: 'al',
      playDate: new Date(2026, 4, 9, 12, 0, 0 - i).toISOString(),
    }));
    mockClient.requestWithLibraryFilter.mockResolvedValue(rows);

    const page0 = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 2, offset: 0, timeRange: 'month' });
    const page1 = await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 2, offset: 2, timeRange: 'month' });

    expect(page0.tracks.map(t => t.id)).toEqual(['s0', 's1']);
    // Page 2 continues past the offset rather than re-returning page 1.
    expect(page1.tracks.map(t => t.id)).toEqual(['s2', 's3']);
  });

  it('timeRange="all": keeps server-side offset (no client-side re-pagination)', async () => {
    mockClient.requestWithLibraryFilter.mockResolvedValue([]);

    await listRecentlyPlayed(mockClient as unknown as NavidromeClient, { limit: 10, offset: 20, timeRange: 'all' });

    const endpoint = mockClient.requestWithLibraryFilter.mock.calls[0]![0];
    // No client-side filter -> server offset is correct; fetch exactly `limit`.
    expect(endpoint).toContain('_start=20');
    expect(endpoint).toContain('_end=30');
  });
});
