/**
 * Navidrome MCP Server - createRadioStation tests
 * Copyright (C) 2025
 *
 * Verifies the v2.0.0 fix to createRadioStation: the response now carries the
 * REAL station id (resolved by listing stations after the create batch and
 * matching on name+streamUrl), instead of the placeholder string 'created'.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stream validation probes the network, so the batch tests drive its verdict directly.
vi.mock('../../../src/tools/radio-validation.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/tools/radio-validation.js')>()),
  validateRadioStream: vi.fn(),
}));

import { createRadioStation } from '../../../src/tools/radio.js';
import { validateRadioStream } from '../../../src/tools/radio-validation.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';

/**
 * Build a synthetic Navidrome REST `/radio` response (array of rows). Defaults
 * are sufficient for createRadioStation's post-create id-resolution path —
 * it matches on (name, streamUrl) and reads id/createdAt/updatedAt.
 */
function makeRestList(stations: Array<{ id: string; name: string; streamUrl: string; createdAt?: string }>) {
  return stations.map(s => ({
    id: s.id,
    name: s.name,
    streamUrl: s.streamUrl,
    homePageUrl: '',
    createdAt: s.createdAt ?? '2025-09-03T22:07:50Z',
    updatedAt: '2025-09-03T22:07:50Z',
  }));
}

describe('createRadioStation real-id resolution', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it('looks up the real station id via REST /radio after create', async () => {
    // subsonicRequest = createInternetRadioStation (returns nothing useful)
    // request = REST GET /radio for post-create id resolution
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'real-uuid-001', name: 'Test Station', streamUrl: 'http://stream.test/audio' }])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Test Station', streamUrl: 'http://stream.test/audio' }],
    });

    expect(result.results).toHaveLength(1);
    const created = result.results[0]!;
    expect(created.success).toBe(true);
    expect(created.station?.id).toBe('real-uuid-001');
    expect(created.station?.id).not.toBe('created');
    expect(created.station?.id).not.toBe('');
    expect(created.station?.createdAt).toBe('2025-09-03T22:07:50Z');
    expect(created.station?.updatedAt).toBe('2025-09-03T22:07:50Z');
    // A resent create would insert a duplicate station.
    expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
      '/createInternetRadioStation',
      expect.any(Object),
      { retryPolicy: 'never' },
    );
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

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
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

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Orphan', streamUrl: 'http://orphan.test/' }],
    });

    // Create still reports success — only id resolution failed. The `note`
    // field tells the LLM to call list_radio_stations rather than
    // delete_radio_station('') which would fail opaquely.
    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.station?.id).toBe('');
    expect(result.results[0]?.note).toMatch(/list_radio_stations/);
    // Timestamps come only from Navidrome, so an unresolved row reports them as unknown.
    expect(result.results[0]?.station?.createdAt).toBeNull();
    expect(result.results[0]?.station?.updatedAt).toBeNull();
  });

  it('notes a saved station that already uses the new stream URL, and no note for a unique URL', async () => {
    mockClient.subsonicRequest
      .mockResolvedValueOnce({ status: 'ok' })
      .mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'old-1', name: 'Groove Salad', streamUrl: 'http://dup.test/', createdAt: '2025-01-01T00:00:00Z' },
        { id: 'new-1', name: 'Groove Salad copy', streamUrl: 'http://dup.test/', createdAt: '2025-09-03T22:07:50Z' },
        { id: 'new-2', name: 'Unique', streamUrl: 'http://unique.test/' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [
        { name: 'Groove Salad copy', streamUrl: 'http://dup.test/' },
        { name: 'Unique', streamUrl: 'http://unique.test/' },
      ],
    });

    expect(result.results[0]?.station?.id).toBe('new-1');
    expect(result.results[0]?.note).toBe('Saved station "Groove Salad" already uses this stream URL.');
    expect(result.results[1]?.note).toBeUndefined();
  });

  it('annotates with a note when create succeeded but station vanished from the listing', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });        // create succeeded
    mockClient.request.mockResolvedValueOnce(makeRestList([]));                // listing returned empty

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Phantom', streamUrl: 'http://phantom.test/' }],
    });

    expect(result.results[0]?.success).toBe(true);
    expect(result.results[0]?.station?.id).toBe('');
    expect(result.results[0]?.note).toMatch(/could not resolve/);
  });

  it('assigns DISTINCT ids to two same-batch stations with identical (name, streamUrl)', async () => {
    // User creates two "WBEZ" stations pointing at the same stream. Navidrome
    // accepts both as separate rows. Without per-batch tracking, both lookups
    // would land on the same newest row and one create would be unreachable.
    mockClient.subsonicRequest
      .mockResolvedValueOnce({ status: 'ok' })  // create #1
      .mockResolvedValueOnce({ status: 'ok' }); // create #2
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'aaa', name: 'WBEZ', streamUrl: 'http://wbez.test/', createdAt: '2025-09-03T22:07:50Z' },
        { id: 'zzz', name: 'WBEZ', streamUrl: 'http://wbez.test/', createdAt: '2025-09-03T22:07:51Z' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [
        { name: 'WBEZ', streamUrl: 'http://wbez.test/' },
        { name: 'WBEZ', streamUrl: 'http://wbez.test/' },
      ],
    });

    const ids = result.results.map(r => r.station?.id);
    // First lookup gets the newest ('zzz'), second gets the next unused ('aaa').
    expect(ids).toEqual(['zzz', 'aaa']);
    // Both must be distinct, non-empty.
    expect(new Set(ids).size).toBe(2);
    expect(ids.every(id => id !== '' && id !== undefined)).toBe(true);
  });

  it('on duplicate name+streamUrl, picks the newest createdAt even when an older id sorts higher', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([
        { id: 'zzzOlder', name: 'Dup', streamUrl: 'http://dup.test/', createdAt: '2025-01-01T00:00:00.000000001-07:00' },
        { id: 'aaaNewest', name: 'Dup', streamUrl: 'http://dup.test/', createdAt: '2026-07-08T16:25:48.905110966-07:00' },
        { id: 'mmmMiddle', name: 'Dup', streamUrl: 'http://dup.test/', createdAt: '2025-06-01T00:00:00Z' },
      ])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Dup', streamUrl: 'http://dup.test/' }],
    });
    expect(result.results[0]?.station?.id).toBe('aaaNewest');
  });

  it('skips the create and counts a validation failure when validateBeforeAdd rejects the stream', async () => {
    vi.mocked(validateRadioStream).mockResolvedValueOnce({ success: false, errors: ['HTTP 404'] } as never);

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Dead', streamUrl: 'http://stream.test/dead' }],
      validateBeforeAdd: true,
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/Stream validation failed/);
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
    expect(result.summary).toContain('(1 due to validation)');
  });

  it('skips lookup entirely when no creates succeeded', async () => {
    mockClient.subsonicRequest.mockRejectedValueOnce(new Error('Subsonic create failed'));

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
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
      createRadioStation(mockClient as unknown as NavidromeClient, null)
    ).rejects.toThrow();
  });

  it('throws when stations array is missing', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, { validateBeforeAdd: false })
    ).rejects.toThrow();
  });

  it('throws when stations is empty array', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, { stations: [] })
    ).rejects.toThrow();
  });

  it('throws when stations is not an array', async () => {
    await expect(
      createRadioStation(mockClient as unknown as NavidromeClient, { stations: 'bad' })
    ).rejects.toThrow();
  });

  it('returns per-item failure (not a throw) for empty name within valid batch', async () => {
    // Per-item validation stays in the loop so a batch with one bad entry
    // still processes the rest — Zod validates array structure but not min(1)
    // on individual name/url (those are checked per-item in the loop).
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: '', streamUrl: 'http://stream.test/' }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/name.*required|required.*name/i);
    // No Subsonic call — validation failed before network
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });
});

describe('createRadioStation URL validation', () => {
  let mockClient: MockNavidromeClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  // The WHATWG URL parser strips tab/LF/CR, so these parse to a clean http:
  // URL while the RAW string is what gets stored and later handed to mpv.
  it('rejects a stream URL carrying a newline, before any network call', async () => {
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Injected', streamUrl: 'http://stream.test/live\nHost: internal.local' }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/line breaks or control characters/i);
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });

  it('points an rtsp:// stream to the Navidrome web UI', async () => {
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{ name: 'Camera', streamUrl: 'rtsp://cam.test/live' }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toBe(
      'Stream URL for station "Camera" must use http:// or https://. Add mms://, rtsp:// or rtmp:// stations in the Navidrome web UI instead.',
    );
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-http home page URL', async () => {
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{
        name: 'Bad Homepage',
        streamUrl: 'http://stream.test/audio',
        homePageUrl: 'javascript:alert(1)',
      }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/must use http/i);
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });

  it('rejects a home page URL carrying a newline', async () => {
    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{
        name: 'Injected Homepage',
        streamUrl: 'http://stream.test/audio',
        homePageUrl: 'http://site.test/\nX-Injected: 1',
      }],
    });

    expect(result.results[0]?.success).toBe(false);
    expect(result.results[0]?.error).toMatch(/home page/i);
    expect(mockClient.subsonicRequest).not.toHaveBeenCalled();
  });

  it('still accepts a station with a valid home page URL', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'ok-1', name: 'Good', streamUrl: 'http://stream.test/audio' }])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [{
        name: 'Good',
        streamUrl: 'http://stream.test/audio',
        homePageUrl: 'https://site.test/about',
      }],
    });

    expect(result.results[0]?.success).toBe(true);
    expect(mockClient.subsonicRequest).toHaveBeenCalledWith(
      '/createInternetRadioStation',
      { streamUrl: 'http://stream.test/audio', name: 'Good', homepageUrl: 'https://site.test/about' },
      { retryPolicy: 'never' },
    );
  });

  // The per-station checks live in the loop precisely so one bad entry does not
  // take the batch down with it.
  it('fails only the bad entry in a mixed batch', async () => {
    mockClient.subsonicRequest.mockResolvedValueOnce({ status: 'ok' });
    mockClient.request.mockResolvedValueOnce(
      makeRestList([{ id: 'ok-2', name: 'Fine', streamUrl: 'http://stream.test/ok' }])
    );

    const result = await createRadioStation(mockClient as unknown as NavidromeClient, {
      stations: [
        { name: 'Broken', streamUrl: 'http://stream.test/x\nHost: evil' },
        { name: 'Fine', streamUrl: 'http://stream.test/ok' },
      ],
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.success).toBe(false);
    expect(result.results[1]?.success).toBe(true);
    expect(mockClient.subsonicRequest).toHaveBeenCalledTimes(1);
  });
});
