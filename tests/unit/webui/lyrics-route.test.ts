/**
 * Coverage for the web-UI lyrics endpoint and the player-state flag it pairs with.
 *
 *  - lyrics.ts — id validation before any upstream call, queue resolution,
 *                the missing-metadata path that must never reach a Zod throw,
 *                the two-TTL cache, and the LRCLIB feature gate.
 *  - player.ts — /api/player-state must report `lyrics.lrclibEnabled` so the
 *                overlay can explain an empty result.
 *  - server.ts — both of the above must actually be reachable through the
 *                dispatcher, including the malformed-percent-sequence path.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import type { Config } from '../../../src/config.js';
import type { LyricsDTO } from '../../../src/types/index.js';
import type { SseBroadcaster } from '../../../src/webui/broadcaster.js';
import { createMockClient } from '../../factories/mock-client.js';
import { makeTestConfig } from '../../helpers/test-config.js';

// Mock the live-queue read so no mpv IPC is attempted.
vi.mock('../../../src/tools/playback.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/playback.js')>();
  return { ...actual, getPlayQueue: vi.fn() };
});

// Mock the resolver: this file tests the route around it, and the resolver's own
// behavior is covered by the lyrics tool tests.
vi.mock('../../../src/tools/lyrics.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/tools/lyrics.js')>();
  return { ...actual, getLyrics: vi.fn() };
});

// Belt and braces: nothing in this file may reach an external API.
vi.mock('../../../src/utils/fetch-with-timeout.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/fetch-with-timeout.js')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
    getNavidromeRequestTimeoutMs: vi.fn(() => 5000),
    getExternalApiTimeoutMs: vi.fn(() => 5000),
  };
});

import { getLyrics } from '../../../src/tools/lyrics.js';
import { getPlayQueue } from '../../../src/tools/playback.js';
import { fetchWithTimeout } from '../../../src/utils/fetch-with-timeout.js';
import { handleLyrics } from '../../../src/webui/routes/lyrics.js';
import { handlePlayerState } from '../../../src/webui/routes/player.js';
import { createServer } from '../../../src/webui/server.js';

/** Capture status + body written to a ServerResponse without a real socket. */
interface CapturedRes {
  res: ServerResponse;
  status: () => number | undefined;
  json: () => unknown;
}

function fakeRes(): CapturedRes {
  let status: number | undefined;
  let body = '';
  const res = {
    writableEnded: false,
    writeHead(code: number): ServerResponse {
      status = code;
      return res;
    },
    end(chunk?: string): void {
      if (typeof chunk === 'string') body += chunk;
    },
  } as unknown as ServerResponse;
  return {
    res,
    status: () => status,
    json: () => (body === '' ? undefined : JSON.parse(body)),
  };
}

/** IncomingMessage stand-in with a fixed peer address. */
function fakeReq(remoteAddress: string): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage & { socket: { remoteAddress: string } };
  emitter.socket = { remoteAddress } as never;
  queueMicrotask(() => {
    emitter.emit('end');
  });
  return emitter;
}

interface QueueEntry {
  index: number;
  songId: string | null;
  isCurrent: boolean;
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
}

function queueOf(...entries: QueueEntry[]): void {
  vi.mocked(getPlayQueue).mockResolvedValue({
    items: entries,
    length: entries.length,
    currentIndex: 0,
  });
}

function entry(songId: string, extra: Partial<QueueEntry> = {}): QueueEntry {
  return {
    index: 0,
    songId,
    isCurrent: true,
    isPlaying: true,
    title: 'Hollaback Girl',
    artist: 'Gwen Stefani',
    album: 'Love Angel Music Baby',
    duration: 199,
    ...extra,
  };
}

const ATTRIBUTION: LyricsDTO['attribution'] = {
  url: 'https://lrclib.net',
  license: 'community-sourced',
};

function syncedDto(): LyricsDTO {
  return {
    track: { title: 'Hollaback Girl', artist: 'Gwen Stefani', durationMs: 199000 },
    synced: [
      { timeMs: 1000, endMs: 3000, text: 'first line' },
      { timeMs: 3000, endMs: 6500, text: 'second line' },
    ],
    hasSynced: true,
    isInstrumental: false,
    provider: 'lrclib',
    attribution: ATTRIBUTION,
  };
}

function emptyDto(): LyricsDTO {
  return {
    track: { title: 'Hollaback Girl', artist: 'Gwen Stefani' },
    hasSynced: false,
    isInstrumental: false,
    provider: 'lrclib',
    attribution: ATTRIBUTION,
  };
}

function testClient(): NavidromeClient {
  return createMockClient() as unknown as NavidromeClient;
}

/** Raw request so a malformed percent-sequence survives to the server verbatim. */
function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(config: Config, run: (port: number) => Promise<void>): Promise<void> {
  const server = createServer({
    config,
    client: testClient(),
    broadcaster: {} as unknown as SseBroadcaster,
    shutdown: () => undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}

const LYRICS_ON = makeTestConfig({ features: { lyrics: true } });
const LYRICS_OFF = makeTestConfig({ features: { lyrics: false } });

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleLyrics id validation', () => {
  it('rejects a path-traversal id with 400 and never reaches the queue or the resolver', async () => {
    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), '../secrets');

    expect(cap.status()).toBe(400);
    expect(getPlayQueue).not.toHaveBeenCalled();
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it('rejects a raw percent-sequence id with 400 rather than 500', async () => {
    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), '%GG');

    expect(cap.status()).toBe(400);
    expect(getLyrics).not.toHaveBeenCalled();
  });
});

describe('handleLyrics queue resolution', () => {
  it('returns 200 with endMs and hasSynced for a queued song that has lyrics', async () => {
    queueOf(entry('songSynced1'));
    vi.mocked(getLyrics).mockResolvedValue(syncedDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songSynced1');

    expect(cap.status()).toBe(200);
    const dto = cap.json() as LyricsDTO;
    expect(dto.hasSynced).toBe(true);
    expect(dto.synced?.[0]?.endMs).toBe(3000);
  });

  it('returns 404 when the songId is valid but absent from the live queue', async () => {
    queueOf(entry('songOther1'));

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songMissing1');

    expect(cap.status()).toBe(404);
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it('returns 200 with an empty DTO when nothing has lyrics', async () => {
    queueOf(entry('songEmpty1'));
    vi.mocked(getLyrics).mockResolvedValue(emptyDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songEmpty1');

    expect(cap.status()).toBe(200);
    const dto = cap.json() as LyricsDTO;
    expect(dto.hasSynced).toBe(false);
    expect(dto.synced).toBeUndefined();
    expect(dto.unsynced).toBeUndefined();
  });

  it('returns 502 rather than 500 when the resolver throws', async () => {
    queueOf(entry('songBroken1'));
    vi.mocked(getLyrics).mockRejectedValue(new Error('LRCLIB is down'));

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songBroken1');

    expect(cap.status()).toBe(502);
  });
});

describe('handleLyrics missing queue metadata', () => {
  it('answers 200 local-only for an entry with no artist instead of throwing a schema error', async () => {
    queueOf(entry('songNoArtist1', { artist: undefined }));
    vi.mocked(getLyrics).mockResolvedValue(emptyDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songNoArtist1');

    expect(cap.status()).toBe(200);
    expect(getLyrics).toHaveBeenCalledTimes(1);
    const call = vi.mocked(getLyrics).mock.calls[0];
    // The placeholder keeps GetLyricsSchema satisfied but must never be searched.
    expect(call?.[1]).toMatchObject({ artist: 'Unknown', title: 'Hollaback Girl' });
    expect(call?.[2]).toMatchObject({ songId: 'songNoArtist1', allowLrclib: false });
  });

  it('answers 200 local-only for an entry with no title', async () => {
    queueOf(entry('songNoTitle1', { title: undefined }));
    vi.mocked(getLyrics).mockResolvedValue(emptyDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songNoTitle1');

    expect(cap.status()).toBe(200);
    expect(vi.mocked(getLyrics).mock.calls[0]?.[2]).toMatchObject({ allowLrclib: false });
  });
});

describe('handleLyrics caching', () => {
  it('serves a repeat request from cache without re-resolving', async () => {
    queueOf(entry('songCacheHit1'));
    vi.mocked(getLyrics).mockResolvedValue(syncedDto());

    const first = fakeRes();
    await handleLyrics(first.res, LYRICS_ON, testClient(), 'songCacheHit1');
    const second = fakeRes();
    await handleLyrics(second.res, LYRICS_ON, testClient(), 'songCacheHit1');

    expect(first.status()).toBe(200);
    expect(second.status()).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(getLyrics).toHaveBeenCalledTimes(1);
    expect(getPlayQueue).toHaveBeenCalledTimes(1);
  });

  it('serves a cached miss without re-resolving', async () => {
    queueOf(entry('songCacheMiss1'));
    vi.mocked(getLyrics).mockResolvedValue(emptyDto());

    const first = fakeRes();
    await handleLyrics(first.res, LYRICS_ON, testClient(), 'songCacheMiss1');
    const second = fakeRes();
    await handleLyrics(second.res, LYRICS_ON, testClient(), 'songCacheMiss1');

    expect(second.status()).toBe(200);
    expect((second.json() as LyricsDTO).hasSynced).toBe(false);
    expect(getLyrics).toHaveBeenCalledTimes(1);
  });
});

describe('handleLyrics LRCLIB feature gate', () => {
  it('passes allowLrclib false and issues no outbound request when features.lyrics is off', async () => {
    queueOf(entry('songGated1'));
    vi.mocked(getLyrics).mockResolvedValue(emptyDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_OFF, testClient(), 'songGated1');

    expect(cap.status()).toBe(200);
    expect(vi.mocked(getLyrics).mock.calls[0]?.[2]).toMatchObject({ allowLrclib: false });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('passes allowLrclib true when features.lyrics is on and the entry is fully tagged', async () => {
    queueOf(entry('songGated2'));
    vi.mocked(getLyrics).mockResolvedValue(syncedDto());

    const cap = fakeRes();
    await handleLyrics(cap.res, LYRICS_ON, testClient(), 'songGated2');

    expect(cap.status()).toBe(200);
    expect(vi.mocked(getLyrics).mock.calls[0]?.[2]).toMatchObject({ allowLrclib: true });
  });
});

describe('handlePlayerState lyrics flag', () => {
  it('reports lrclibEnabled true when the lyrics feature is configured', () => {
    const cap = fakeRes();
    handlePlayerState(fakeReq('127.0.0.1'), cap.res, LYRICS_ON);

    expect(cap.status()).toBe(200);
    expect(cap.json()).toMatchObject({ isLocal: true, lyrics: { lrclibEnabled: true } });
  });

  it('reports lrclibEnabled false when the lyrics feature is off', () => {
    const cap = fakeRes();
    handlePlayerState(fakeReq('127.0.0.1'), cap.res, LYRICS_OFF);

    expect(cap.json()).toMatchObject({ lyrics: { lrclibEnabled: false } });
  });
});

describe('lyrics route wiring', () => {
  it('dispatches GET /api/lyrics/:songId to the handler', async () => {
    queueOf(entry('songWired1'));
    vi.mocked(getLyrics).mockResolvedValue(syncedDto());

    await withServer(LYRICS_ON, async (port) => {
      const res = await httpGet(port, '/api/lyrics/songWired1');
      expect(res.status).toBe(200);
      expect((JSON.parse(res.body) as LyricsDTO).hasSynced).toBe(true);
    });
  });

  it('answers 400 for a malformed percent-sequence rather than 500', async () => {
    await withServer(LYRICS_ON, async (port) => {
      const res = await httpGet(port, '/api/lyrics/%GG');
      expect(res.status).toBe(400);
      expect(getPlayQueue).not.toHaveBeenCalled();
    });
  });

  it('threads config into GET /api/player-state so the lyrics flag is reported', async () => {
    await withServer(LYRICS_ON, async (port) => {
      const res = await httpGet(port, '/api/player-state');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ lyrics: { lrclibEnabled: true } });
    });
  });
});
