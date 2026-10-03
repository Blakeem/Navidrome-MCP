/**
 * Navidrome MCP Server - MusicBrainz client unit tests
 * Copyright (C) 2025
 *
 * Covers the MB utility behind get_artist_albums and get_album_info: the
 * 1 req/s throttle queue, release-group browse paging, genre mapping,
 * artist-search pick logic, User-Agent sourcing, release-group lookup/search
 * (exact-title vs. score fallback), and release-browse tracklist selection
 * (Official-preferred/earliest-date, multi-disc renumbering). All fetches are
 * mocked (never hit musicbrainz.org).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestConfig } from '../../helpers/test-config.js';
import {
  browseMbReleaseGroups,
  browseMbReleaseTracklist,
  lookupMbArtist,
  lookupMbReleaseGroup,
  resetMusicBrainzThrottleForTests,
  searchMbArtist,
  searchMbReleaseGroup,
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

function errorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
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

  it('returns null when MB answers 404 for an unknown MBID', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(404, 'Not Found')) as unknown as typeof fetch;
    expect(await lookupMbArtist('00000000-0000-4000-8000-000000000000', makeTestConfig())).toBeNull();
  });

  it('still throws when MB answers 503', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(503, 'Service Unavailable')) as unknown as typeof fetch;
    await expect(lookupMbArtist('mbid-x', makeTestConfig())).rejects.toThrow(/MusicBrainz/);
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

describe('lookupMbReleaseGroup', () => {
  it('maps artist-credit, genres, year, and types for an MBID', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      id: 'rg-mbid',
      title: 'Dark All Day',
      'first-release-date': '2018-10-05',
      'primary-type': 'Album',
      'secondary-types': ['Compilation'],
      genres: [
        { name: 'Electronic', count: 2 },
        { name: 'Synthwave', count: 7 },
      ],
      'artist-credit': [{ name: 'GUNSHIP' }, { name: 'Tim Cappello' }],
      disambiguation: 'the studio album',
    })) as unknown as typeof fetch;

    const detail = await lookupMbReleaseGroup('rg-mbid', makeTestConfig());
    expect(detail?.mbid).toBe('rg-mbid');
    expect(detail?.title).toBe('Dark All Day');
    expect(detail?.artistName).toBe('GUNSHIP'); // first credit only
    expect(detail?.year).toBe(2018);
    expect(detail?.primaryType).toBe('Album');
    expect(detail?.secondaryTypes).toEqual(['compilation']);
    expect(detail?.genres).toEqual(['synthwave', 'electronic']); // vote-count desc
    expect(detail?.disambiguation).toBe('the studio album');
  });

  it('returns null artistName when MB supplies no artist-credit', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      id: 'rg-mbid',
      title: 'Untitled',
      'first-release-date': '',
    })) as unknown as typeof fetch;

    const detail = await lookupMbReleaseGroup('rg-mbid', makeTestConfig());
    expect(detail?.artistName).toBeNull();
    expect(detail?.year).toBeNull();
    expect(detail?.genres).toEqual([]);
  });

  it('requests genres + artist-credits inc on the lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'rg', title: 'X' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await lookupMbReleaseGroup('rg', makeTestConfig());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    // URLSearchParams serializes the space in the inc list as '+'; normalize it.
    expect(decodeURIComponent(url).replaceAll('+', ' ')).toContain('inc=genres artist-credits');
    expect(url).toContain('/release-group/rg');
  });

  it('returns null when the row lacks an id/title', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ title: 'No Id' })) as unknown as typeof fetch;
    expect(await lookupMbReleaseGroup('rg', makeTestConfig())).toBeNull();
  });

  it('returns null when MB answers 404, as for a release MBID', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(404, 'Not Found')) as unknown as typeof fetch;
    expect(await lookupMbReleaseGroup('release-mbid-not-rg', makeTestConfig())).toBeNull();
  });

  it('still throws when MB answers 503', async () => {
    global.fetch = vi.fn().mockResolvedValue(errorResponse(503, 'Service Unavailable')) as unknown as typeof fetch;
    await expect(lookupMbReleaseGroup('rg', makeTestConfig())).rejects.toThrow(/MusicBrainz/);
  });
});

describe('searchMbReleaseGroup', () => {
  function rgHit(id: string, title: string, score: number): Record<string, unknown> {
    return {
      id,
      title,
      score,
      'first-release-date': '2018-10-05',
      'primary-type': 'Album',
      'artist-credit': [{ name: 'GUNSHIP' }],
    };
  }

  it('prefers the normalized-title exact match over a higher-scored decoy', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      'release-groups': [
        rgHit('decoy', 'Dark All Night', 100),
        rgHit('exact', 'Dark All Day (Deluxe Edition)', 88),
      ],
    })) as unknown as typeof fetch;

    // normTitle strips the "(Deluxe Edition)" noise group, so the lower-scored
    // hit is the exact-title match and must win despite the decoy's score 100.
    const detail = await searchMbReleaseGroup('GUNSHIP', 'Dark All Day', makeTestConfig());
    expect(detail?.mbid).toBe('exact');
  });

  it('falls back to the top hit when it clears the score threshold', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      'release-groups': [rgHit('top', 'Darkest Days', 92)],
    })) as unknown as typeof fetch;

    const detail = await searchMbReleaseGroup('GUNSHIP', 'Dark All Day', makeTestConfig());
    expect(detail?.mbid).toBe('top');
  });

  it('returns null when there is no exact match and the top score is too low', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      'release-groups': [rgHit('weak', 'Something Unrelated', 40)],
    })) as unknown as typeof fetch;

    expect(await searchMbReleaseGroup('GUNSHIP', 'Dark All Day', makeTestConfig())).toBeNull();
  });

  it('returns null on an empty result set', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ 'release-groups': [] })) as unknown as typeof fetch;
    expect(await searchMbReleaseGroup('GUNSHIP', 'Nothing', makeTestConfig())).toBeNull();
  });
});

describe('browseMbReleaseTracklist', () => {
  function track(title: string, position: number, length?: number): Record<string, unknown> {
    return length === undefined ? { title, position } : { title, position, length };
  }
  function medium(position: number, tracks: Array<Record<string, unknown>>): Record<string, unknown> {
    return { position, tracks };
  }
  function release(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id,
      status: 'Official',
      date: '2020-01-01',
      country: 'XW',
      media: [medium(1, [track('T1', 1, 240000)])],
      ...overrides,
    };
  }

  it('renumbers tracks sequentially across sorted multi-disc media', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [release('r1', {
        media: [
          // Disc 2 listed first and tracks out of order — both must be sorted.
          medium(2, [track('B2', 2), track('B1', 1)]),
          medium(1, [track('A2', 2), track('A1', 1)]),
        ],
      })],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.tracks.map(t => t.title)).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(list?.tracks.map(t => t.position)).toEqual([1, 2, 3, 4]);
  });

  it('rounds track length to whole seconds and keeps null when absent', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [release('r1', {
        media: [medium(1, [
          track('exact', 1, 240000),   // 240s
          track('rounded', 2, 90500),  // 90.5s → 91
          track('unknown', 3),         // no length → null
        ])],
      })],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.tracks.map(t => t.durationSeconds)).toEqual([240, 91, null]);
  });

  it('prefers an Official release over an earlier non-Official one', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [
        release('bootleg', { status: 'Bootleg', date: '2015-01-01' }),
        release('official', { status: 'Official', date: '2020-01-01' }),
      ],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.releaseMbid).toBe('official');
    expect(list?.status).toBe('Official');
  });

  it('within the pool picks the earliest date, sorting undated last', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [
        release('full', { date: '2019-06-01' }),
        release('partial', { date: '2018' }),   // partial date sorts before full 2018-xx / 2019
        release('undated', { date: null }),
      ],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.releaseMbid).toBe('partial');
    expect(list?.date).toBe('2018');
    expect(list?.country).toBe('XW');
  });

  it('treats an empty-string date as undated, so the dated original wins', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [
        release('undated-reissue', { date: '', country: '' }),
        release('original', { date: '1969-09-26' }),
      ],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.releaseMbid).toBe('original');
    expect(list?.date).toBe('1969-09-26');
  });

  it('reports an empty-string date and country as null', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [release('only', { date: '', country: '' })],
    })) as unknown as typeof fetch;

    const list = await browseMbReleaseTracklist('rg', makeTestConfig());
    expect(list?.date).toBeNull();
    expect(list?.country).toBeNull();
  });

  it('returns null when no release has a usable tracklist', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({
      releases: [
        { id: 'no-tracks', status: 'Official', date: '2020-01-01', media: [] },
        // A medium whose only track lacks a title → dropped → release has 0 tracks.
        { id: 'titleless', status: 'Official', date: '2020-01-01', media: [medium(1, [{ position: 1 }])] },
      ],
    })) as unknown as typeof fetch;

    expect(await browseMbReleaseTracklist('rg', makeTestConfig())).toBeNull();
  });

  it('returns null on an empty releases array', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ releases: [] })) as unknown as typeof fetch;
    expect(await browseMbReleaseTracklist('rg', makeTestConfig())).toBeNull();
  });
});
