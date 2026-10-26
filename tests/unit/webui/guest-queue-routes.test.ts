// The guest queue runs on a fake engine, so each case checks how a route answers a guest or the host.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NavidromeClient } from '../../../src/client/navidrome-client.js';
import { readSettings, writeSettings } from '../../../src/config/store.js';
import { QueueEntryStartedError, type QueueEntry } from '../../../src/services/playback/playback-engine.js';
import { getGuestQueueLimit, getJukeboxShareLink, setGuestQueueLimit, setJukeboxShareLink } from '../../../src/web/player-runtime.js';
import type { GuestSession } from '../../../src/webui/auth/auth-store.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';
import { handleQueueRemove } from '../../../src/webui/routes/controls.js';
import { handleGuestAdd, handleGuestNickname, handleGuestRemove, handleGuestSearch } from '../../../src/webui/routes/guest-queue.js';
import { handleGetJukeboxSettings, handleSetJukeboxSettings } from '../../../src/webui/routes/jukebox.js';
import { createMockClient, type MockNavidromeClient } from '../../factories/mock-client.js';

// searchAll refreshes the filter cache before resolving text filters, which would hit Navidrome.
vi.mock('../../../src/services/filter-cache-manager.js', () => ({
  filterCacheManager: { ensureFresh: vi.fn().mockResolvedValue(undefined) },
}));

interface Captured {
  res: ServerResponse;
  status: () => number | undefined;
  json: () => Record<string, unknown>;
  header: (name: string) => string | undefined;
}

function fakeRes(): Captured {
  let status: number | undefined;
  let body = '';
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string): void {
      headers[name.toLowerCase()] = value;
    },
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
    json: () => JSON.parse(body) as Record<string, unknown>,
    header: (name) => headers[name.toLowerCase()],
  };
}

function fakeReq(body: unknown): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  Object.assign(emitter, { socket: { remoteAddress: '127.0.0.1' } });
  queueMicrotask(() => {
    emitter.emit('data', Buffer.from(JSON.stringify(body)));
    emitter.emit('end');
  });
  return emitter;
}

function guestSession(id: string, nickname: string | null = null): GuestSession {
  return { id, role: 'guest', label: 'Guest 1', nickname } as GuestSession;
}

function fakeEngine(queue: QueueEntry[]): Record<string, unknown> {
  let nextId = 50;
  return {
    enqueue: vi.fn((songIds: string[]) => {
      const entryId = nextId++;
      queue.push({ index: queue.length, entryId, songId: songIds[0] ?? null, isCurrent: false, isPlaying: false });
      return Promise.resolve({ demoted: false, outputMissing: null, entryIds: [entryId] });
    }),
    getQueue: vi.fn(() => Promise.resolve(queue.map((queued) => ({ ...queued })))),
    isRunning: () => true,
    readPaused: vi.fn(() => Promise.resolve(false)),
    readReplaceGeneration: vi.fn(() => Promise.resolve(0)),
    readReplaceMarks: vi.fn(() => Promise.resolve({ generation: 0, pending: false })),
    // Mirrors the engine: a song id that names another song is gone, and a playing entry refuses.
    removeQueueEntryById: vi.fn((entryId: number, options: { songId?: string; refuseStarted?: boolean } = {}) => {
      const index = queue.findIndex((queued) => queued.entryId === entryId);
      const queued = queue[index];
      if (queued === undefined || (options.songId !== undefined && queued.songId !== options.songId)) return Promise.resolve(false);
      if (options.refuseStarted === true && queued.isCurrent && queued.isPlaying) return Promise.reject(new QueueEntryStartedError(entryId));
      queue.splice(index, 1);
      return Promise.resolve(true);
    }),
    onStateChange: () => () => undefined,
  };
}

let client: MockNavidromeClient;
let queue: QueueEntry[];
let guests: GuestQueue;
const ana = guestSession('session-ana', 'Ana');

beforeEach(() => {
  client = createMockClient();
  queue = [{ index: 0, entryId: 1, songId: 'host-song', isCurrent: true, isPlaying: true }];
  guests = new GuestQueue(fakeEngine(queue) as never, () => 2);
});

function asClient(): NavidromeClient {
  return client as unknown as NavidromeClient;
}

function songRow(id: string): Record<string, unknown> {
  return { id, title: `Title ${id}`, artist: 'Artist', album: 'Album', albumId: 'al-1', artistId: 'ar-1', duration: 180, path: '/secret/path.flac' };
}

describe('GET /api/guest/search', () => {
  it.each([
    ['missing', null],
    ['blank', '   '],
    ['101-character', 'a'.repeat(101)],
  ])('refuses a %s query with 400 and no Navidrome call', async (_label, rawQuery) => {
    const cap = fakeRes();
    await handleGuestSearch(cap.res, asClient(), guests, ana, rawQuery);

    expect(cap.status()).toBe(400);
    expect(cap.json()['error']).toBe('Enter 1 to 100 characters to search.');
    expect(client.requestWithLibraryFilterAndMeta).not.toHaveBeenCalled();
  });

  it('searches songs only, at most 20, in the active libraries, and returns only the guest fields', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [songRow('so-1')], total: 1 });
    const cap = fakeRes();

    await handleGuestSearch(cap.res, asClient(), guests, ana, '  daft ');

    const endpoints = client.requestWithLibraryFilterAndMeta.mock.calls.map((call) => call[0]);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatch(/^\/song\?/);
    expect(new URL(endpoints[0] ?? '', 'http://x').searchParams.get('_end')).toBe('20');
    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ songs: [{ id: 'so-1', title: 'Title so-1', artist: 'Artist', album: 'Album', duration: expect.any(Number) as number }] });
  });

  it('allows 30 searches a minute per guest, then answers 429 with Retry-After', async () => {
    client.requestWithLibraryFilterAndMeta.mockResolvedValue({ data: [], total: 0 });
    for (let i = 0; i < 30; i++) await handleGuestSearch(fakeRes().res, asClient(), guests, ana, 'q');
    const cap = fakeRes();

    await handleGuestSearch(cap.res, asClient(), guests, ana, 'q');
    const other = fakeRes();
    await handleGuestSearch(other.res, asClient(), guests, guestSession('session-bo'), 'q');

    expect(cap.status()).toBe(429);
    expect(Number(cap.header('Retry-After'))).toBeGreaterThan(0);
    expect(other.status()).toBe(200);
  });
});

describe('POST /api/guest/nickname', () => {
  it('answers 401 and writes nothing when the session ended while the body was read', async () => {
    const auth = { isLiveGuest: vi.fn(() => false), takeNicknameToken: vi.fn(() => 0), setGuestNickname: vi.fn() };
    const relabel = vi.fn();
    const cap = fakeRes();

    await handleGuestNickname(fakeReq({ nickname: 'Ana B' }), cap.res, auth, { relabel }, guestSession('session-ana', 'Ana'));

    expect([cap.status(), cap.json()['code']]).toEqual([401, 'signed-out']);
    expect(auth.isLiveGuest).toHaveBeenCalledWith('session-ana');
    expect(auth.takeNicknameToken).not.toHaveBeenCalled();
    expect(auth.setGuestNickname).not.toHaveBeenCalled();
    expect(relabel).not.toHaveBeenCalled();
  });
});

describe('POST /api/guest/queue', () => {
  async function add(songId: string, session = ana, isLiveGuest: (sessionId: string) => boolean = () => true): Promise<Captured> {
    const cap = fakeRes();
    await handleGuestAdd(fakeReq({ songId }), cap.res, asClient(), guests, { isLiveGuest }, session);
    return cap;
  }

  it('looks the song up in the active libraries, appends it, and answers its entry id and slots left', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([songRow('so-1')]);

    const cap = await add('so-1');

    expect(client.requestWithLibraryFilter).toHaveBeenCalledWith(expect.stringMatching(/^\/song\?id=so-1&/));
    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ ok: true, entryId: 50, remaining: 1 });
    expect(guests.ledger.guestLabelOf(50)).toBe('Ana');
  });

  it('answers 404 for a song outside the active libraries', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([]);

    const cap = await add('so-x');

    expect(cap.status()).toBe(404);
    expect(cap.json()['code']).toBe('unknown-song');
  });

  it('answers 409 radio while a radio stream plays', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([songRow('so-1')]);
    queue.splice(0, 1, { index: 0, entryId: 1, songId: null, isCurrent: true, isPlaying: true });

    const cap = await add('so-1');

    expect([cap.status(), cap.json()['code']]).toEqual([409, 'radio']);
  });

  it('answers 429 limit once the guest holds the limit of unplayed songs', async () => {
    client.requestWithLibraryFilter.mockImplementation((endpoint: string) => Promise.resolve([songRow(new URL(endpoint, 'http://x').searchParams.get('id') ?? '')]));
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });
    guests.ledger.record(61, { sessionId: ana.id, song: { songId: 'so-61' }, guestLabel: 'Ana', addedAt: 0 });
    queue.push({ index: 1, entryId: 60, songId: 'so-60', isCurrent: false, isPlaying: false });
    queue.push({ index: 2, entryId: 61, songId: 'so-61', isCurrent: false, isPlaying: false });

    const cap = await add('so-1');

    expect([cap.status(), cap.json()['code']]).toEqual([429, 'limit']);
    expect(cap.json()['error']).toContain('2 songs waiting');
    expect(cap.header('Retry-After')).toBeUndefined();
  });

  it('answers 409 duplicate for a song already waiting', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([songRow('so-1')]);
    queue.push({ index: 1, entryId: 2, songId: 'so-1', isCurrent: false, isPlaying: false });

    const cap = await add('so-1');

    expect([cap.status(), cap.json()['code']]).toEqual([409, 'duplicate']);
  });

  it('answers 429 with Retry-After for a second add within 5 seconds', async () => {
    client.requestWithLibraryFilter.mockImplementation((endpoint: string) => Promise.resolve([songRow(new URL(endpoint, 'http://x').searchParams.get('id') ?? '')]));
    await add('so-1');

    const cap = await add('so-2');

    expect(cap.status()).toBe(429);
    expect(Number(cap.header('Retry-After'))).toBeGreaterThan(0);
  });

  it('answers 502 and says the song was added when mpv reports no entry id', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([songRow('so-1')]);
    const engine = fakeEngine(queue);
    engine['enqueue'] = vi.fn(() => Promise.resolve({ demoted: false, outputMissing: null, entryIds: [] }));
    guests = new GuestQueue(engine as never, () => 2);

    const cap = await add('so-1');

    expect(cap.status()).toBe(502);
    expect(cap.json()['error']).toContain('The song was added');
  });

  it('answers 401 and queues nothing when the session ended before the add ran', async () => {
    client.requestWithLibraryFilter.mockResolvedValue([songRow('so-1')]);
    const isLiveGuest = vi.fn(() => false);

    const cap = await add('so-1', ana, isLiveGuest);

    expect([cap.status(), cap.json()['code']]).toEqual([401, 'signed-out']);
    expect(isLiveGuest).toHaveBeenCalledWith(ana.id);
    expect(queue.map((queued) => queued.songId)).toEqual(['host-song']);
    expect(guests.ledger.isEmpty()).toBe(true);
  });

  it('answers 400 for a malformed song id', async () => {
    const cap = await add('../etc');

    expect(cap.status()).toBe(400);
    expect(client.requestWithLibraryFilter).not.toHaveBeenCalled();
  });

  it('answers 500 with the cause when Navidrome fails the lookup', async () => {
    client.requestWithLibraryFilter.mockRejectedValue(new Error('Navidrome unreachable'));

    const cap = await add('so-1');

    expect(cap.status()).toBe(500);
    expect(cap.json()['error']).toContain('Navidrome unreachable');
  });
});

describe('POST /api/guest/queue/remove', () => {
  async function remove(entryId: unknown, session = ana, isLiveGuest: (sessionId: string) => boolean = () => true): Promise<Captured> {
    const cap = fakeRes();
    await handleGuestRemove(fakeReq({ entryId }), cap.res, guests, { isLiveGuest }, session);
    return cap;
  }

  beforeEach(() => {
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });
    queue.push({ index: 1, entryId: 60, songId: 'so-60', isCurrent: false, isPlaying: false });
  });

  it("removes the guest's own song", async () => {
    const cap = await remove(60);

    expect(cap.status()).toBe(200);
    expect(cap.json()).toEqual({ ok: true, remaining: 2 });
    expect(queue.map((queued) => queued.entryId)).toEqual([1]);
  });

  it('answers 401 and removes nothing when the session ended while the body was read', async () => {
    const engine = fakeEngine(queue);
    guests = new GuestQueue(engine as never, () => 2);
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });
    const isLiveGuest = vi.fn(() => false);
    const onChange = vi.fn();
    guests.watch(onChange);

    const cap = await remove(60, ana, isLiveGuest);

    expect([cap.status(), cap.json()['code']]).toEqual([401, 'signed-out']);
    expect(isLiveGuest).toHaveBeenCalledWith(ana.id);
    expect(engine['getQueue']).not.toHaveBeenCalled();
    expect(queue.map((queued) => queued.entryId)).toEqual([1, 60]);
    expect(guests.ledger.ownerOf(60)).toBe(ana.id);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('answers 401 and removes nothing when the session ended while the queue was read', async () => {
    const isLiveGuest = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    const cap = await remove(60, ana, isLiveGuest);

    expect([cap.status(), cap.json()['code']]).toEqual([401, 'signed-out']);
    expect(cap.json()['error']).toContain('song was not removed');
    expect(isLiveGuest).toHaveBeenCalledTimes(2);
    expect(queue.map((queued) => queued.entryId)).toEqual([1, 60]);
    expect(guests.ledger.ownerOf(60)).toBe(ana.id);
  });

  it("answers 404 for another guest's song or a host song", async () => {
    expect((await remove(60, guestSession('session-bo'))).status()).toBe(404);
    expect((await remove(1)).status()).toBe(404);
    expect(queue).toHaveLength(2);
  });

  it('answers 409 started for a song that already started', async () => {
    queue[0] = { ...queue[0]!, isCurrent: false };
    queue[1] = { ...queue[1]!, isCurrent: true };

    const cap = await remove(60);

    expect([cap.status(), cap.json()['code']]).toEqual([409, 'started']);
  });

  it('answers 404 and keeps the record when the mpv connection drops during the removal', async () => {
    let running = true;
    const engine = fakeEngine(queue);
    engine['isRunning'] = () => running;
    engine['removeQueueEntryById'] = vi.fn(() => {
      running = false;
      return Promise.resolve(false);
    });
    guests = new GuestQueue(engine as never, () => 2);
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });

    expect((await remove(60)).status()).toBe(404);
    expect(guests.ledger.ownerOf(60)).toBe(ana.id);
  });

  it.each([-1, 1.5, '60'])('answers 400 for entry id %s', async (entryId) => {
    expect((await remove(entryId)).status()).toBe(400);
  });
});

describe('POST /api/controls/queue/remove', () => {
  async function hostRemove(entryId: unknown): Promise<Captured> {
    const cap = fakeRes();
    await handleQueueRemove(fakeReq({ entryId }), cap.res, guests);
    return cap;
  }

  beforeEach(() => {
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });
    queue.push(
      { index: 1, entryId: 60, songId: 'so-60', isCurrent: false, isPlaying: false },
      { index: 2, entryId: 61, songId: 'host-next', isCurrent: false, isPlaying: false },
    );
  });

  it('removes a host song by its entry id, wherever the queue moved it', async () => {
    queue.reverse();

    const cap = await hostRemove(61);

    expect([cap.status(), cap.json()]).toEqual([200, { ok: true }]);
    expect(queue.map((queued) => queued.entryId)).toEqual([60, 1]);
  });

  it("removes a guest's song and forgets it, so the guest's slot frees", async () => {
    expect(guests.counts(ana.id).remaining).toBe(1);

    const cap = await hostRemove(60);

    expect(cap.status()).toBe(200);
    expect(queue.map((queued) => queued.entryId)).toEqual([1, 61]);
    expect(guests.ledger.ownerOf(60)).toBeNull();
    expect(guests.counts(ana.id).remaining).toBe(2);
  });

  it('answers 404 for an entry the queue no longer holds', async () => {
    const cap = await hostRemove(99);

    expect([cap.status(), cap.json()['code']]).toEqual([404, 'not-found']);
    expect(queue).toHaveLength(3);
  });

  it('removes the song a new mpv instance put under a guest entry id, and drops the stale record', async () => {
    queue[1] = { ...queue[1]!, songId: 'other-song' };

    expect((await hostRemove(60)).status()).toBe(200);
    expect(queue.map((queued) => queued.entryId)).toEqual([1, 61]);
    expect(guests.ledger.ownerOf(60)).toBeNull();
  });

  it('answers 404 and forgets a guest song that leaves the queue between the refresh and the removal', async () => {
    const engine = fakeEngine(queue);
    engine['removeQueueEntryById'] = vi.fn(() => Promise.resolve(false));
    guests = new GuestQueue(engine as never, () => 2);
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });

    expect((await hostRemove(60)).status()).toBe(404);
    expect(guests.ledger.ownerOf(60)).toBeNull();
  });

  it('answers 404 and keeps the guest record while no mpv is attached', async () => {
    const engine = fakeEngine(queue);
    engine['isRunning'] = () => false;
    engine['removeQueueEntryById'] = vi.fn(() => Promise.resolve(false));
    guests = new GuestQueue(engine as never, () => 2);
    guests.ledger.record(60, { sessionId: ana.id, song: { songId: 'so-60' }, guestLabel: 'Ana', addedAt: 0 });

    expect((await hostRemove(60)).status()).toBe(404);
    expect(guests.ledger.ownerOf(60)).toBe(ana.id);
  });

  it('answers 500 with the cause when the engine fails, and keeps every entry', async () => {
    const engine = fakeEngine(queue);
    engine['removeQueueEntryById'] = vi.fn(() => Promise.reject(new Error('ipc closed')));
    guests = new GuestQueue(engine as never, () => 2);

    const cap = await hostRemove(61);

    expect([cap.status(), cap.json()['error']]).toEqual([500, 'ipc closed']);
    expect(queue).toHaveLength(3);
  });

  it('answers 409 started for the playing entry and keeps it', async () => {
    const cap = await hostRemove(1);

    expect([cap.status(), cap.json()['code']]).toEqual([409, 'started']);
    expect(queue.map((queued) => queued.entryId)).toEqual([1, 60, 61]);
  });

  it.each([-1, 1.5, '60'])('answers 400 for entry id %s', async (entryId) => {
    expect((await hostRemove(entryId)).status()).toBe(400);
  });
});

describe('jukebox settings routes', () => {
  let dir: string;
  let savedPath: string | undefined;
  const broadcaster = { broadcastNow: vi.fn() };

  beforeEach(() => {
    savedPath = process.env['NAVIDROME_CONFIG_PATH'];
    dir = mkdtempSync(join(tmpdir(), 'nd-jukebox-settings-'));
    process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
    broadcaster.broadcastNow.mockClear();
  });

  afterEach(() => {
    setGuestQueueLimit(3);
    setJukeboxShareLink('lan');
    if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
    else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies the limit at once, persists it, and sends every page a snapshot', async () => {
    writeSettings({ navidrome: { url: 'http://h:4533', username: 'u', password: 'p' } });
    const cap = fakeRes();

    await handleSetJukeboxSettings(fakeReq({ guestQueueLimit: 5 }), cap.res, broadcaster);

    expect(cap.json()).toEqual({ guestQueueLimit: 5, shareLink: 'lan', persisted: true });
    expect(getGuestQueueLimit()).toBe(5);
    expect(readSettings()?.jukebox?.guestQueueLimit).toBe(5);
    expect(broadcaster.broadcastNow).toHaveBeenCalledTimes(1);
    const read = fakeRes();
    handleGetJukeboxSettings(read.res);
    expect(read.json()).toEqual({ guestQueueLimit: 5, shareLink: 'lan' });
  });

  it('applies and persists the share link alone, keeps the limit, and sends no snapshot', async () => {
    writeSettings({ navidrome: { url: 'http://h:4533', username: 'u', password: 'p' }, jukebox: { guestQueueLimit: 3 } });
    const cap = fakeRes();

    await handleSetJukeboxSettings(fakeReq({ shareLink: 'internet' }), cap.res, broadcaster);

    expect(cap.json()).toEqual({ guestQueueLimit: 3, shareLink: 'internet', persisted: true });
    expect(getJukeboxShareLink()).toBe('internet');
    expect(readSettings()?.jukebox).toEqual({ guestQueueLimit: 3, shareLink: 'internet' });
    expect(broadcaster.broadcastNow).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown link', { shareLink: 'wifi' }, 'shareLink must be one of lan, internet'],
    ['an empty patch', {}, 'Send guestQueueLimit, shareLink or both'],
  ])('refuses %s with 400 and keeps the live values', async (_label, body, error) => {
    const cap = fakeRes();

    await handleSetJukeboxSettings(fakeReq(body), cap.res, broadcaster);

    expect(cap.status()).toBe(400);
    expect(cap.json()['error']).toBe(error);
    expect(getJukeboxShareLink()).toBe('lan');
    expect(getGuestQueueLimit()).toBe(3);
  });

  it('applies the limit for this session only when no store exists', async () => {
    const cap = fakeRes();

    await handleSetJukeboxSettings(fakeReq({ guestQueueLimit: 4 }), cap.res, broadcaster);

    expect(cap.json()).toEqual({ guestQueueLimit: 4, shareLink: 'lan', persisted: false });
    expect(getGuestQueueLimit()).toBe(4);
  });

  it.each([0, 21, 2.5, '3'])('refuses a limit of %s with 400 and keeps the live value', async (guestQueueLimit) => {
    const cap = fakeRes();

    await handleSetJukeboxSettings(fakeReq({ guestQueueLimit }), cap.res, broadcaster);

    expect(cap.status()).toBe(400);
    expect(cap.json()['error']).toBe('guestQueueLimit must be a whole number from 1 to 20');
    expect(getGuestQueueLimit()).toBe(3);
    expect(broadcaster.broadcastNow).not.toHaveBeenCalled();
  });
});
