/**
 * Navidrome MCP Server - createRadioStation tests
 * Copyright (C) 2025
 *
 * Verifies the v2.0.0 fix to createRadioStation: the response now carries the
 * REAL station id (resolved by listing stations after the create batch and
 * matching on name+streamUrl), instead of the placeholder string 'created'.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createRadioStation, resetRadioStationCacheForTesting } from '../../../src/tools/radio.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';

const stubConfig = {} as Config;

/**
 * Build a synthetic Navidrome REST `/radio` response (array of rows). Defaults
 * are sufficient for createRadioStation's post-create id-resolution path —
 * it matches on (name, streamUrl) and reads id/createdAt/updatedAt.
 */
function makeRestList(stations: Array<{ id: string; name: string; streamUrl: string }>) {
  return stations.map(s => ({
    id: s.id,
    name: s.name,
    streamUrl: s.streamUrl,
    homePageUrl: '',
    createdAt: '2025-09-03T22:07:50Z',
    updatedAt: '2025-09-03T22:07:50Z',
  }));
}

describe('createRadioStation real-id resolution', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    resetRadioStationCacheForTesting();
    mockClient = createMockClient();
  });

  it('looks up the real station id via REST /radio after create', async () => {
    // subsonicRequest = createInternetRadioStation (returns nothing useful)
    // request = REST GET /radio for post-create id resolution
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'real-uuid-001', name: 'Test Station', streamUrl: 'http://stream.test/audio' }])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: 'Test Station', streamUrl: 'http://stream.test/audio' }],
    });

    expect(result.results).toHaveLength(1);
    const created = result.results[0]!;
    expect(created.success).toBe(true);
    expect(created.station?.id).toBe('real-uuid-001');
    expect(created.station?.id).not.toBe('created');
    expect(created.station?.id).not.toBe('');
  });

  it('only issues ONE REST list call regardless of batch size', async () => {
    // 3 creates (Subsonic) + 1 REST list = 4 total network calls.
    mockClient.subsonicRequest
      .mockResolvedValueOnce({ status: 'ok' }) // create #1
      .mockResolvedValueOnce({ status: 'ok' }) // create #2
      .mockResolvedValueOnce({ status: 'ok' }); // create #3
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'id-1', name: 'A', streamUrl: 'http://a.test/' },
        { id: 'id-2', name: 'B', streamUrl: 'http://b.test/' },
        { id: 'id-3', name: 'C', streamUrl: 'http://c.test/' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [
        { name: 'A', streamUrl: 'http://a.test/' },
        { name: 'B', streamUrl: 'http://b.test/' },
        { name: 'C', streamUrl: 'http://c.test/' },
      ],
    });

    // 3 createInternetRadioStation (Subsonic) + 1 REST listRadioStations
    expect(mockClient.subsonicRequest).toHaveBeenCalledTimes(3);
    expect(mockClient.request).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(3);
    expect(result.results.map(r => r.station?.id)).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('falls back to empty id with a note when the lookup fails', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' }); // create succeeded
    mockClient.request.mockRejectedValueOnce(new Error('list failed'));  // REST list failed

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: 'Orphan', streamUrl: 'http://orphan.test/' }],
    });

    // Create still reports success — only id resolution failed. The `note`
    // field tells the LLM to call list_radio_stations rather than
    // delete_radio_station('') which would fail opaquely.
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.station?.id).toBe('');
    expect(result.results[0]?.note).toMatch(/list_radio_stations/);
  });

  it('annotates with a note when create succeeded but station vanished from the listing', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });        // create succeeded
    mockClient.request.mockResolvedValueOnce(makeRestList([]));                // listing returned empty

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: 'Phantom', streamUrl: 'http://phantom.test/' }],
    });

    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.station?.id).toBe('');
    expect(result.results[0]?.note).toMatch(/could not resolve/);
  });

  it('assigns DISTINCT ids to two same-batch stations with identical (name, streamUrl)', async () => {
    // User creates two "WBEZ" stations pointing at the same stream — Navidrome
    // accepts both as separate rows. Without per-batch tracking, both lookups
    // would land on the same lex-max id and one create would be unreachable.
    mockClient.subsonicRequest
      .mockResolvedValueOnce({ status: 'ok' })  // create #1
      .mockResolvedValueOnce({ status: 'ok' }); // create #2
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'aaa', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { id: 'zzz', name: 'WBEZ', streamUrl: 'http://wbez.test/' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [
        { name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { name: 'WBEZ', streamUrl: 'http://wbez.test/' },
      ],
    });

    const ids = result.results.map(r => r.station?.id);
    // First lookup gets lex-max ('zzz'), second gets the next unused ('aaa').
    expect(ids).toEqual(['zzz', 'aaa']);
    // Both must be distinct, non-empty.
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id !== '' && id !== undefined)).toBe(true);
  });

  it('on duplicate name+streamUrl, picks the lexicographically max id (newest)', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'aaa', name: 'Dup', streamUrl: 'http://dup.test/' },
        { id: 'zzz', name: 'Dup', streamUrl: 'http://dup.test/' },
        { id: 'mmm', name: 'Dup', streamUrl: 'http://dup.test/' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: 'Dup', streamUrl: 'http://dup.test/' }],
    });
    expect(result.results[0]?.station?.id).toBe('zzz');
  });

  it('skips lookup entirely when no creates succeeded', async () => {
    mockClient.subsonicRequest.mockRejectedValueOnce(new Error('Subsonic create failed'));

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: 'Bad', streamUrl: 'http://bad.test/' }],
    });

    expect(result.results[0]?.success).toBe(false);
    // Only the failed create. No follow-up list call (nothing to look up).
    expect(mockClient.subsonicRequest).toHaveBeenCalledTimes(1);
    expect(mockClient.request).not.toHaveBeenCalled();
  });
});

// ---- createRadioStation Zod input validation --------------------------------

describe('createRadioStation Zod input validation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('throws when args is null', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, null)
    ).rejects.toThrow();
  });

  it('throws when stations array is missing', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, { validateBeforeAdd: false })
    ).rejects.toThrow();
  });

  it('throws when stations is empty array', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, { stations: [] })
    ).rejects.toThrow();
  });

  it('throws when stations is not an array', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, { stations: 'bad' })
    ).rejects.toThrow();
  });

  it('returns per-item failure (not a throw) for empty name within valid batch', async () => {
    // Per-item validation stays in the loop so a batch with one bad entry
    // still processes the rest — Zod validates array structure but not min(1)
    // on individual name/url (those are checked per-item in the loop).
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, stubConfig, {
      stations: [{ name: '', streamUrl: 'http://stream.test/' }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/name.*required|required.*name/i);
    // No Subsonic call — validation failed before network
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });
});
