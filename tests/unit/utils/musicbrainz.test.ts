/**
 * Navidrome MCP Server - MusicBrainz client unit tests
 * Copyright (C) 2025
 *
 * Covers the MB utility behind get_artist_albums: the 1 req/s throttle queue,
 * release-group browse paging, genre mapping, artist-search pick logic, and
 * User-Agent sourcing. All fetches are mocked (never hit musicbrainz.org).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestConfig } from '../../helpers/test-config.js';
import {
  browseMbReleaseGroups,
  lookupMbArtist,
  resetMusicBrainzThrottleForTests,
  searchMbArtist,
} from '../../../src/utils/musicbrainz.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

function artistSearchBody(artists: Array<{ id: string; name: string; score: number; disambiguation?: string }>): unknown {
  return { artists };
}

beforeEach(() => {
  resetMusicBrainzThrottleForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('throttle', () => {
  it('does not dispatch a second request until ~1100ms after the first', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([])));
    global.fetch = fetchMock as unknown as typeof fetch;

    const config = makeTestConfig();
    const first = searchMbArtist('GUNSHIP', config);
    const second = searchMbArtist('Waveshaper', config);

    // First dispatches immediately (lastDispatchAt starts at 0, far in the past
    // relative to fake-timer now? — guard: flush microtasks).
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Just before the interval elapses the second call is still queued.
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Past the interval it goes out.
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([first, second]);
  });

  it('a failed request does not poison the queue for the next caller', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse(artistSearchBody([])));
    global.fetch = fetchMock as unknown as typeof fetch;

    const config = makeTestConfig();
    await expect(searchMbArtist('GUNSHIP', config)).rejects.toThrow();
    await expect(searchMbArtist('Waveshaper', config)).resolves.toBeNull();
  });
});

describe('searchMbArtist', () => {
  beforeEach(() => {
    // Real timers; the single call dispatches immediately on a cold throttle.
  });

  it('prefers the case-insensitive exact name match (score order)', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([
      { id: 'mbid-real', name: 'GUNSHIP', score: 100, disambiguation: 'synthwave' },
      { id: 'mbid-decoy', name: 'Gunship', score: 89, disambiguation: 'not GUNSHIP' },
    ]))) as unknown as typeof fetch;

    const match = await searchMbArtist('gunship', makeTestConfig());
    expect(match?.mbid).toBe('mbid-real');
  });

  it('falls back to the top hit when it clears the score threshold', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([
      { id: 'mbid-top', name: 'Miami Nights 1984', score: 95 },
    ]))) as unknown as typeof fetch;

    const match = await searchMbArtist('Miami Nights 84', makeTestConfig());
    expect(match?.mbid).toBe('mbid-top');
  });

  it('returns null when nothing matches exactly and the top score is too low', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([
      { id: 'mbid-weak', name: 'Something Else Entirely', score: 60 },
    ]))) as unknown as typeof fetch;

    const match = await searchMbArtist('Obscure Artist', makeTestConfig());
    expect(match).toBeNull();
  });

  it('returns null on an empty result set', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([]))) as unknown as typeof fetch;
    expect(await searchMbArtist('Nobody', makeTestConfig())).toBeNull();
  });

  it('sends the configured User-Agent, or the compliant default when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([])));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchMbArtist('A', makeTestConfig({ musicBrainzUserAgent: 'MyApp/1.0 (me@example.com)' }));
    resetMusicBrainzThrottleForTests();
    await searchMbArtist('B', makeTestConfig());

    const uaOf = (call: unknown[]): string => {
      const init = call[1] as { headers: Record<string, string> };
      return init.headers['User-Agent'];
    };
    expect(uaOf(fetchMock.mock.calls[0] ?? [])).toBe('MyApp/1.0 (me@example.com)');
    // Default must be meaningful per MB policy: name + contact URL.
    expect(uaOf(fetchMock.mock.calls[1] ?? [])).toMatch(/Navidrome-MCP \(https:\/\//);
  });

  it('escapes quotes in the Lucene phrase query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(artistSearchBody([])));
    global.fetch = fetchMock as unknown as typeof fetch;

    await searchMbArtist('The "Quoted" Band', makeTestConfig());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    // URLSearchParams encodes spaces as '+'; normalize before asserting.
    expect(decodeURIComponent(url).replaceAll('+', ' ')).toContain('artist:"The \\"Quoted\\" Band"');
  });
});

describe('lookupMbArtist', () => {
  it('returns the canonical name for an MBID', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      id: 'df1356d3-3c66-48bc-ac79-475c6cf76266',
      name: 'GUNSHIP',
      disambiguation: 'synthwave',
    })) as unknown as typeof fetch;

    const match = await lookupMbArtist('df1356d3-3c66-48bc-ac79-475c6cf76266', makeTestConfig());
    expect(match?.name).toBe('GUNSHIP');
    expect(match?.disambiguation).toBe('synthwave');
  });
});

describe('browseMbReleaseGroups', () => {
  function rg(id: string, title: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      title,
      'first-release-date': '2018-10-05',
      'primary-type': 'Album',
      'secondary-types': [],
      genres: [],
      ...overrides,
    };
  }

  it('maps fields, lowercases secondary types, sorts genres by count', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      'release-group-count': 1,
      'release-groups': [
        rg('rg-1', 'Dark All Day', {
          'secondary-types': ['Remix', 'Live'],
          genres: [
            { name: 'electronic', count: 2 },
            { name: 'synthwave', count: 7 },
          ],
        }),
      ],
    })) as unknown as typeof fetch;

    const groups = await browseMbReleaseGroups('mbid-x', ['album'], makeTestConfig());
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g?.title).toBe('Dark All Day');
    expect(g?.year).toBe(2018);
    expect(g?.primaryType).toBe('Album');
    expect(g?.secondaryTypes).toEqual(['remix', 'live']);
    expect(g?.genres).toEqual(['synthwave', 'electronic']);
  });

  it('returns empty genres and null year when MB omits them', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      'release-group-count': 1,
      'release-groups': [rg('rg-1', 'Mystery', { 'first-release-date': '', genres: undefined })],
    })) as unknown as typeof fetch;

    const groups = await browseMbReleaseGroups('mbid-x', ['album'], makeTestConfig());
    expect(groups[0]?.genres).toEqual([]);
    expect(groups[0]?.year).toBeNull();
  });

  it('pages by rows actually returned until the reported total is reached', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => rg(`rg-${i}`, `Album ${i}`));
    const pageTwo = [rg('rg-100', 'Album 100')];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ 'release-group-count': 101, 'release-groups': pageOne }))
      .mockResolvedValueOnce(jsonResponse({ 'release-group-count': 101, 'release-groups': pageTwo }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const groups = await browseMbReleaseGroups('mbid-x', ['album'], makeTestConfig());
    expect(groups).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(secondUrl).toContain('offset=100');
  });

  it('stops on an empty page even when the claimed total says more', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ 'release-group-count': 500, 'release-groups': [rg('rg-1', 'Only One')] }))
      .mockResolvedValueOnce(jsonResponse({ 'release-group-count': 500, 'release-groups': [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const groups = await browseMbReleaseGroups('mbid-x', ['album'], makeTestConfig());
    expect(groups).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('joins multiple primary types with | in the type param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ 'release-group-count': 0, 'release-groups': [] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await browseMbReleaseGroups('mbid-x', ['album', 'ep'], makeTestConfig());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(decodeURIComponent(url)).toContain('type=album|ep');
  });

  it('throws on a non-OK response (degradation is handled by the caller)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      headers: new Headers(),
    } as unknown as Response) as unknown as typeof fetch;

    await expect(browseMbReleaseGroups('mbid-x', ['album'], makeTestConfig())).rejects.toThrow(/MusicBrainz/);
  });
});
