// Every route handler except the auth routes is a stub, so each case measures the access gate alone.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../../src/config.js';
import { logger } from '../../../src/utils/logger.js';
import { hashPassword, randomToken } from '../../../src/utils/secrets.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const stubbed = vi.hoisted(() => ({
  /** Replaces each `handle*` export with a stub that answers 200 on the response argument it receives. */
  stubHandlers<T extends Record<string, unknown>>(actual: T): T {
    const stubs: Record<string, unknown> = { ...actual };
    for (const [name, value] of Object.entries(actual)) {
      if (!name.startsWith('handle') || typeof value !== 'function') continue;
      stubs[name] = (...args: unknown[]): void => {
        const res = args.find((arg) => typeof (arg as { writeHead?: unknown } | null)?.writeHead === 'function') as
          | { writeHead: (status: number) => void; end: (body: string) => void }
          | undefined;
        res?.writeHead(200);
        res?.end(JSON.stringify({ stub: name }));
      };
    }
    return stubs as T;
  },
}));

// A test sets `interfaces` to stand in for this machine's network interfaces, such as none with IPv4.
const osStub = vi.hoisted(() => ({ interfaces: null as NodeJS.Dict<import('node:os').NetworkInterfaceInfo[]> | null }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, networkInterfaces: () => osStub.interfaces ?? actual.networkInterfaces() };
});
vi.mock('../../../src/webui/routes/controls.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/cover.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/health.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/library.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/lyrics.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/network-info.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/playlists.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/visualizer-modes.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/player.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));
vi.mock('../../../src/webui/routes/static-files.js', async (importOriginal) => stubbed.stubHandlers(await importOriginal()));

import { AuthService, type GuestStatus } from '../../../src/webui/auth/auth-service.js';
import { outsideLevelMessage } from '../../../src/webui/auth/principal.js';
import { GuestQueue } from '../../../src/webui/jukebox/guest-queue.js';
import { adminView, guestEndCard, guestView, keyFromHash, offersAdminLogin } from '../../../src/webui/public/page-view.js';
import { MAX_OPEN_STREAMS, REFUSED_STREAM_RETRY_MS, STREAM_EVICTED_EVENT } from '../../../src/webui/stream-limiter.js';
import { createServer, listRoutes } from '../../../src/webui/server.js';

const LOOPBACK = '127.0.0.1';
const LAN_PEER = '192.168.1.50';
const INTERNET_PEER = '203.0.113.5';
const PASSWORD = 'correct horse battery';

const broadcastNow = vi.fn();
let adminHash = '';

function newDeviceId(): string {
  return randomToken(16);
}

beforeAll(async () => {
  adminHash = await hashPassword(PASSWORD);
});

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env['NAVIDROME_CONFIG_PATH'];
  dir = mkdtempSync(join(tmpdir(), 'nd-access-'));
  process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  osStub.interfaces = null;
  if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
  else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
  rmSync(dir, { recursive: true, force: true });
});

function lanConfig(auth: Partial<Config['webui']['auth']> = {}): Config {
  const base = makeTestConfig();
  return makeTestConfig({
    webui: {
      ...base.webui,
      host: '0.0.0.0',
      expose: true,
      auth: { mode: 'jukebox', adminPasswordHash: adminHash, adminAccess: 'localhost', ...auth },
    },
  });
}

interface Reply {
  status: number | undefined;
  headers: Record<string, string | string[]>;
  body: string;
  res: FakeResponse;
}

class FakeResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  status: number | undefined;
  readonly headers: Record<string, string | string[]> = {};
  body = '';
  setHeader(name: string, value: string | string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  writeHead(code: number, headers: Record<string, string> = {}): this {
    this.status = code;
    this.headersSent = true;
    for (const [name, value] of Object.entries(headers)) this.headers[name.toLowerCase()] = value;
    return this;
  }
  readonly written: string[] = [];
  write(chunk?: string): boolean {
    if (typeof chunk === 'string') this.written.push(chunk);
    return true;
  }
  end(chunk?: string): void {
    if (typeof chunk === 'string') this.body += chunk;
    this.writableEnded = true;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  peer?: string;
  host?: string;
  body?: unknown;
  headers?: Record<string, string>;
  guests?: GuestQueue;
  /** A stream cap spans requests, so a test that counts open streams reuses one server. */
  server?: Server;
}

function buildServer(config: Config, auth: AuthService, guests: GuestQueue = new GuestQueue()): Server {
  return createServer({
    config,
    client: {} as never,
    broadcaster: {
      addClient: (stream: FakeResponse) => { stream.writeHead(200); },
      addGuestClient: (stream: FakeResponse) => { stream.writeHead(200); },
      broadcastNow,
    } as never,
    visualizer: { addClient: (stream: ServerResponse) => { (stream as unknown as FakeResponse).writeHead(200); } },
    shutdown: () => undefined,
    leases: { open: () => undefined, close: () => undefined },
    auth,
    guests,
  });
}

/** A real socket is always loopback, so a fake request carries the chosen peer address. */
async function dispatch(config: Config, auth: AuthService, path: string, options: RequestOptions = {}): Promise<Reply> {
  const method = options.method ?? 'GET';
  const host = options.host ?? '192.168.1.20:8808';
  const req = new EventEmitter() as IncomingMessage;
  const headers: Record<string, string> = { host, ...options.headers };
  if (method === 'POST') headers['content-type'] = 'application/json';
  Object.assign(req, {
    url: path,
    method,
    headers,
    rawHeaders: Object.entries(headers).flat(),
    socket: { remoteAddress: options.peer ?? LOOPBACK },
  });
  queueMicrotask(() => {
    if (method === 'POST') req.emit('data', Buffer.from(JSON.stringify(options.body ?? {})));
    req.emit('end');
  });
  const res = new FakeResponse();
  (options.server ?? buildServer(config, auth, options.guests)).emit('request', req, res as unknown as ServerResponse);
  await vi.waitFor(() => expect(res.status).toBeDefined());
  return { status: res.status, headers: res.headers, body: res.body, res };
}

/** A guest join can set the session and device cookies at once, so the header holds a string or an array. */
function setCookies(reply: Reply): string[] {
  const value = reply.headers['set-cookie'];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** The name=value part of the named cookie the reply set, ready for a request's Cookie header. */
function cookiePair(reply: Reply, name: string): string {
  const cookie = setCookies(reply).find((candidate) => candidate.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`no ${name} cookie was set`);
  return cookie.split(';')[0] ?? '';
}

function adminHeaders(auth: AuthService): Record<string, string> {
  const { token, session } = auth.createSession(LOOPBACK);
  return { cookie: `ndmcp-web-8808=${token}`, 'x-csrf-token': session.csrfToken };
}

/** Starts a jukebox when none is active, then joins it as a new guest whose browser holds its device cookie. */
function guestHeaders(auth: AuthService, key = auth.createJukeboxCode(24, false).key): Record<string, string> {
  const deviceId = newDeviceId();
  const joined = auth.join(key, null, LAN_PEER, null, deviceId);
  if (joined.kind !== 'joined') throw new Error(`join failed: ${joined.kind}`);
  return { cookie: `ndmcp-web-8808=${joined.token}; ndmcp-device-8808=${deviceId}`, 'x-csrf-token': joined.session.csrfToken };
}

describe('route access table', () => {
  /**
   * `open*` columns run in mode none, `password*` in mode password, and `admin*`, `anonymous` and `guest` in mode jukebox.
   * A `*Remote` admin is a LAN admin session inside the admin access level `lan`, and answers as the local admin unless a case names it.
   */
  type Expected = {
    open: number; openRemote: number; passwordAdmin: number; passwordAnonymous: number; admin: number; anonymous: number; guest: number;
    passwordAdminRemote?: number; adminRemote?: number;
  };
  const GATED: Expected = { open: 200, openRemote: 200, passwordAdmin: 200, passwordAnonymous: 401, admin: 200, anonymous: 401, guest: 403 };
  const LOCAL_ONLY: Expected = { ...GATED, openRemote: 404, passwordAdminRemote: 404, adminRemote: 404 };
  const PUBLIC: Expected = { open: 200, openRemote: 200, passwordAdmin: 200, passwordAnonymous: 200, admin: 200, anonymous: 200, guest: 200 };
  const REDIRECT: Expected = { open: 302, openRemote: 302, passwordAdmin: 302, passwordAnonymous: 302, admin: 302, anonymous: 302, guest: 302 };
  const MEDIA: Expected = { ...GATED, guest: 200 };
  // Only mode jukebox has the jukebox routes, so modes none and password answer 404 to everyone.
  const NO_JUKEBOX = { open: 404, openRemote: 404, passwordAdmin: 404, passwordAnonymous: 404 } as const;
  const JUKEBOX_VIEW: Expected = { ...NO_JUKEBOX, admin: 200, anonymous: 401, guest: 200 };
  const JUKEBOX_MANAGE: Expected = { ...NO_JUKEBOX, admin: 200, anonymous: 401, guest: 403 };
  // The empty query or body fails validation once a guest reaches the route.
  const JUKEBOX_QUEUE: Expected = { ...NO_JUKEBOX, admin: 403, anonymous: 401, guest: 400 };

  /** Keyed by method and path. A prefix route is requested with a sample id. */
  const TABLE: Record<string, Expected & { request?: string }> = {
    'GET /': REDIRECT,
    'GET /index.html': REDIRECT,
    'GET /admin': PUBLIC,
    'GET /healthz': PUBLIC,
    'POST /api/mcp-lease': PUBLIC,
    'GET /api/auth/session': PUBLIC,
    // The empty body fails validation once the login is reachable. Mode none hides the login, and a
    // LAN guest is outside the default admin access level.
    'POST /api/auth/login': { open: 404, openRemote: 404, passwordAdmin: 400, passwordAnonymous: 400, admin: 400, anonymous: 400, guest: 404 },
    'POST /api/auth/logout': { ...GATED, guest: 200 },
    'GET /guest': PUBLIC,
    'GET /guest.html': PUBLIC,
    // The empty body fails validation. Only mode jukebox has the join.
    'POST /api/auth/join': { ...NO_JUKEBOX, admin: 400, anonymous: 400, guest: 400 },
    'GET /api/events': GATED,
    'GET /api/player-state': GATED,
    'GET /api/visualizer': MEDIA,
    'GET /api/visualizer/modes': MEDIA,
    'GET /api/guest/events': JUKEBOX_VIEW,
    'GET /api/jukebox/key': JUKEBOX_MANAGE,
    'GET /api/jukebox/code': JUKEBOX_MANAGE,
    // The empty body fails validation once the route is reachable.
    'POST /api/jukebox/key': { ...JUKEBOX_MANAGE, admin: 400 },
    'POST /api/jukebox/key/revoke': JUKEBOX_MANAGE,
    'GET /api/jukebox/settings': JUKEBOX_MANAGE,
    'POST /api/jukebox/settings': { ...JUKEBOX_MANAGE, admin: 400 },
    'GET /api/jukebox/guests': JUKEBOX_MANAGE,
    'POST /api/jukebox/guests/remove': { ...JUKEBOX_MANAGE, admin: 400 },
    'POST /api/jukebox/guests/ban': { ...JUKEBOX_MANAGE, admin: 400 },
    'GET /api/jukebox/bans': JUKEBOX_MANAGE,
    'POST /api/jukebox/bans/remove': { ...JUKEBOX_MANAGE, admin: 400 },
    'GET /api/guest/search': JUKEBOX_QUEUE,
    'POST /api/guest/queue': JUKEBOX_QUEUE,
    'POST /api/guest/queue/remove': JUKEBOX_QUEUE,
    'POST /api/guest/nickname': JUKEBOX_QUEUE,
    'POST /api/controls/pause': GATED,
    'POST /api/controls/resume': GATED,
    'POST /api/controls/next': GATED,
    'POST /api/controls/previous': GATED,
    'POST /api/controls/seek': GATED,
    'POST /api/controls/volume': GATED,
    'POST /api/controls/play-index': GATED,
    'POST /api/controls/clear': GATED,
    'POST /api/controls/queue/remove': GATED,
    'POST /api/controls/shuffle': GATED,
    'POST /api/library/play': GATED,
    'GET /api/audio-devices': GATED,
    'POST /api/controls/audio-device': GATED,
    'GET /api/playlists': GATED,
    'GET /api/library/recent': GATED,
    'GET /api/library/search': GATED,
    'GET /api/library/artist-albums': GATED,
    'GET /api/library/album-songs': GATED,
    'GET /api/library/favorites': GATED,
    'GET /api/network-info': GATED,
    'GET /api/player/settings': LOCAL_ONLY,
    'POST /api/player/settings': LOCAL_ONLY,
    'POST /api/shutdown': LOCAL_ONLY,
    'GET /api/cover/': { ...MEDIA, request: '/api/cover/al-1' },
    'GET /api/lyrics/': { ...MEDIA, request: '/api/lyrics/so-1' },
  };

  it('covers every dispatcher route, so a new route needs a case here', () => {
    const routeKeys = listRoutes().map((route) => `${route.method} ${route.path}`);

    expect(routeKeys.sort()).toEqual(Object.keys(TABLE).sort());
  });

  const cases = Object.entries(TABLE).map(([key, expected]) => {
    const [method, path] = key.split(' ') as ['GET' | 'POST', string];
    return { key, method, request: expected.request ?? path, expected };
  });

  it.each(cases)('$key answers each principal as its access says', async ({ method, request, expected }) => {
    const open = makeTestConfig({ webui: { ...lanConfig().webui, auth: { mode: 'none', adminPasswordHash: null, adminAccess: 'localhost' } } });
    const openAuth = new AuthService(open);
    const password = lanConfig({ mode: 'password' });
    const passwordAuth = new AuthService(password);
    const jukebox = lanConfig();
    const jukeboxAuth = new AuthService(jukebox);
    const passwordLan = lanConfig({ mode: 'password', adminAccess: 'lan' });
    const passwordLanAuth = new AuthService(passwordLan);
    const jukeboxLan = lanConfig({ adminAccess: 'lan' });
    const jukeboxLanAuth = new AuthService(jukeboxLan);

    const openLocal = await dispatch(open, openAuth, request, { method, host: '127.0.0.1:8808' });
    const openRemote = await dispatch(open, openAuth, request, { method, peer: LAN_PEER });
    const passwordAdmin = await dispatch(password, passwordAuth, request, { method, host: '127.0.0.1:8808', headers: adminHeaders(passwordAuth) });
    const passwordAnonymous = await dispatch(password, passwordAuth, request, { method, host: '127.0.0.1:8808' });
    const passwordAdminRemote = await dispatch(passwordLan, passwordLanAuth, request, { method, peer: LAN_PEER, headers: adminHeaders(passwordLanAuth) });
    const admin = await dispatch(jukebox, jukeboxAuth, request, { method, host: '127.0.0.1:8808', headers: adminHeaders(jukeboxAuth) });
    const adminRemote = await dispatch(jukeboxLan, jukeboxLanAuth, request, { method, peer: LAN_PEER, headers: adminHeaders(jukeboxLanAuth) });
    const anonymous = await dispatch(jukebox, jukeboxAuth, request, { method, host: '127.0.0.1:8808' });
    const guest = await dispatch(jukebox, jukeboxAuth, request, { method, peer: LAN_PEER, headers: guestHeaders(jukeboxAuth) });

    expect({
      open: openLocal.status,
      openRemote: openRemote.status,
      passwordAdmin: passwordAdmin.status,
      passwordAnonymous: passwordAnonymous.status,
      passwordAdminRemote: passwordAdminRemote.status,
      admin: admin.status,
      adminRemote: adminRemote.status,
      anonymous: anonymous.status,
      guest: guest.status,
    }).toEqual({
      open: expected.open,
      openRemote: expected.openRemote,
      passwordAdmin: expected.passwordAdmin,
      passwordAnonymous: expected.passwordAnonymous,
      passwordAdminRemote: expected.passwordAdminRemote ?? expected.passwordAdmin,
      admin: expected.admin,
      adminRemote: expected.adminRemote ?? expected.admin,
      anonymous: expected.anonymous,
      guest: expected.guest,
    });
    if (expected.anonymous === 401) expect(JSON.parse(anonymous.body)).toMatchObject({ code: 'login' });
  });

  it('serves static files to every principal, so the login page loads', async () => {
    const config = lanConfig();
    expect((await dispatch(config, new AuthService(config), '/styles.css')).status).toBe(200);
  });

  it('answers 404 for a path no route names', async () => {
    const config = lanConfig();
    expect((await dispatch(config, new AuthService(config), '/api/unknown')).status).toBe(404);
  });
});

describe('page router', () => {
  const LOCAL = { peer: LOOPBACK, host: '127.0.0.1:8808' };
  const REMOTE = { peer: LAN_PEER };
  const noSession = (): Record<string, string> => ({});
  const JOIN = { guest: 'join', guestWithKey: 'join-key' } as const;
  const CLOSED = { guest: 'closed', guestWithKey: 'closed' } as const;

  /** The admin access level is `localhost`, so a LAN peer is outside it. */
  const ROWS = [
    { mode: 'none', visitor: 'anyone on this computer', from: LOCAL, headers: noSession, root: '/admin', admin: 'player', ...CLOSED },
    { mode: 'none', visitor: 'anyone on the LAN', from: REMOTE, headers: noSession, root: '/admin', admin: 'player', ...CLOSED },
    { mode: 'password', visitor: 'anonymous inside level', from: LOCAL, headers: noSession, root: '/admin', admin: 'login', ...CLOSED },
    { mode: 'password', visitor: 'anonymous outside level', from: REMOTE, headers: noSession, root: '/admin', admin: 'unavailable', ...CLOSED },
    { mode: 'password', visitor: 'admin session', from: LOCAL, headers: adminHeaders, root: '/admin', admin: 'player', ...CLOSED },
    { mode: 'password', visitor: 'admin session outside level', from: REMOTE, headers: adminHeaders, root: '/admin', admin: 'outside-level', ...CLOSED },
    { mode: 'jukebox', visitor: 'anonymous inside level', from: LOCAL, headers: noSession, root: '/guest', admin: 'login', ...JOIN },
    { mode: 'jukebox', visitor: 'anonymous outside level', from: REMOTE, headers: noSession, root: '/guest', admin: 'unavailable', ...JOIN },
    { mode: 'jukebox', visitor: 'guest session inside level', from: LOCAL, headers: guestHeaders, root: '/guest', admin: 'login', guest: 'guest', guestWithKey: 'join-key' },
    { mode: 'jukebox', visitor: 'guest session outside level', from: REMOTE, headers: guestHeaders, root: '/guest', admin: 'unavailable', guest: 'guest', guestWithKey: 'join-key' },
    { mode: 'jukebox', visitor: 'admin session', from: LOCAL, headers: adminHeaders, root: '/admin', admin: 'player', guest: 'preview', guestWithKey: 'join-key' },
    { mode: 'jukebox', visitor: 'admin session outside level', from: REMOTE, headers: adminHeaders, root: '/guest', admin: 'outside-level', ...JOIN },
  ] as const;

  it.each(ROWS)('mode $mode, $visitor: / goes to $root, /admin shows $admin, /guest shows $guest', async (row) => {
    const config = lanConfig(row.mode === 'none' ? { mode: 'none', adminPasswordHash: null } : { mode: row.mode });
    const auth = new AuthService(config);
    const options = { ...row.from, headers: row.headers(auth) };

    const root = await dispatch(config, auth, '/', options);
    const session: unknown = JSON.parse((await dispatch(config, auth, '/api/auth/session', options)).body);
    const adminPage = await dispatch(config, auth, '/admin', options);
    const guestPage = await dispatch(config, auth, '/guest', options);

    expect({ status: root.status, location: root.headers['location'], cache: root.headers['cache-control'] })
      .toEqual({ status: 302, location: row.root, cache: 'no-store' });
    expect({ admin: adminView(session), guest: guestView(session, false), guestWithKey: guestView(session, true) })
      .toEqual({ admin: row.admin, guest: row.guest, guestWithKey: row.guestWithKey });
    expect([adminPage.status, guestPage.status]).toEqual([200, 200]);
  });

  it.each([
    { visitor: 'anonymous inside level', from: LOCAL, adminLink: true },
    { visitor: 'anonymous outside level', from: REMOTE, adminLink: false },
  ])('mode jukebox, $visitor, the join card shows the admin login link is $adminLink', async ({ from, adminLink }) => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const session: unknown = JSON.parse((await dispatch(config, auth, '/api/auth/session', from)).body);

    expect({ guest: guestView(session, false), adminLink: offersAdminLogin('join', session) }).toEqual({ guest: 'join', adminLink });
  });

  // A failed or ended join shows the join card again, so the link stays for the session read at load.
  it('keeps the admin login link on a join card after a failed join, and never shows it on the closed card', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const session: unknown = JSON.parse((await dispatch(config, auth, '/api/auth/session', LOCAL)).body);

    expect({ join: offersAdminLogin('join', session), closed: offersAdminLogin('closed', session), unread: offersAdminLogin('join', null) })
      .toEqual({ join: true, closed: false, unread: false });
  });

  it('names each guest end reason, and names no cause for a missing or unknown reason', () => {
    const NEW_CODE_HINT = 'Scan a new code from the host to join again.';
    const UNKNOWN_END_HELP = "Scan the host's jukebox code to join again.";

    expect(['closed', 'expired', 'idle', 'new-code', 'removed', undefined, '', 'toString'].map(guestEndCard)).toEqual([
      { help: 'The host closed the jukebox.', hint: NEW_CODE_HINT },
      { help: 'The jukebox code expired.', hint: NEW_CODE_HINT },
      { help: 'Your jukebox session expired. Scan the code again to rejoin.', hint: '' },
      { help: 'The host made a new jukebox code. Scan the new code to rejoin.', hint: '' },
      { help: 'The host removed you from the jukebox.', hint: '' },
      { help: UNKNOWN_END_HELP, hint: '' },
      { help: UNKNOWN_END_HELP, hint: '' },
      { help: UNKNOWN_END_HELP, hint: '' },
    ]);
  });

  it('reads the guest key from the fragment, and keeps an empty k= as a join attempt', () => {
    expect(['#k=abc123', '#k=', '', '#', '#other=1'].map(keyFromHash)).toEqual(['abc123', '', null, null, null]);
  });

  it('sends /index.html to the admin page', async () => {
    const config = lanConfig();

    const reply = await dispatch(config, new AuthService(config), '/index.html', LOCAL);

    expect(reply.status).toBe(302);
    expect(reply.headers['location']).toBe('/admin');
  });

  it('reports the access level refusal to an admin session outside the level', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await dispatch(config, auth, '/api/auth/session', { ...REMOTE, headers: adminHeaders(auth) });

    expect(JSON.parse(reply.body)).toEqual({
      mode: 'jukebox', role: 'anonymous', outsideLevelMessage: outsideLevelMessage('localhost'), adminLoginAvailable: false, isLocal: false, yourAddress: LAN_PEER,
    });
  });
});

describe('login mode gate', () => {
  it('serves an internet peer the login gate instead of the open-mode refusal', async () => {
    const config = lanConfig({ adminAccess: 'anywhere' });
    const reply = await dispatch(config, new AuthService(config), '/api/player-state', { peer: INTERNET_PEER });

    expect(reply.status).toBe(401);
  });

  it.each([
    ['mode none', { mode: 'none' }],
    ['level localhost', { adminAccess: 'localhost' }],
    ['level lan', { adminAccess: 'lan' }],
    ['mode password at level lan', { mode: 'password', adminAccess: 'lan' }],
  ] as const)('refuses an internet peer at %s, where it cannot log in, and names the access settings', async (_label, auth) => {
    const config = lanConfig(auth);
    const reply = await dispatch(config, new AuthService(config), '/api/auth/session', { peer: INTERNET_PEER });

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).error).toContain('admin login is allowed from anywhere');
  });

  // Columns: mode, admin access level, whether a jukebox code is open, and the status an internet peer gets.
  it.each([
    ['none', 'localhost', false, 403], ['none', 'localhost', true, 403],
    ['none', 'lan', false, 403], ['none', 'lan', true, 403],
    ['none', 'anywhere', false, 403], ['none', 'anywhere', true, 403],
    ['password', 'localhost', false, 403], ['password', 'localhost', true, 403],
    ['password', 'lan', false, 403], ['password', 'lan', true, 403],
    ['password', 'anywhere', false, 200], ['password', 'anywhere', true, 200],
    ['jukebox', 'localhost', false, 403], ['jukebox', 'localhost', true, 200],
    ['jukebox', 'lan', false, 403], ['jukebox', 'lan', true, 200],
    ['jukebox', 'anywhere', false, 200], ['jukebox', 'anywhere', true, 200],
  ] as const)('in mode %s at level %s with a code open: %s, an internet peer gets %d', async (mode, adminAccess, codeOpen, status) => {
    const config = lanConfig({ mode, adminAccess });
    const auth = new AuthService(config);
    if (codeOpen) auth.createJukeboxCode(2, false);

    const reply = await dispatch(config, auth, '/api/auth/session', { peer: INTERNET_PEER });

    expect(reply.status).toBe(status);
  });

  it('refuses a session POST without the right X-CSRF-Token', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { cookie } = adminHeaders(auth);

    const missing = await dispatch(config, auth, '/api/controls/pause', { method: 'POST', host: '127.0.0.1:8808', headers: { cookie } });
    const wrong = await dispatch(config, auth, '/api/controls/pause', {
      method: 'POST', host: '127.0.0.1:8808', headers: { cookie, 'x-csrf-token': 'wrong' },
    });

    expect([missing.status, wrong.status]).toEqual([403, 403]);
    expect(JSON.parse(missing.body).error).toContain('X-CSRF-Token');
  });

  it.each([
    ['localhost', LAN_PEER, 403],
    ['localhost', LOOPBACK, 200],
    ['lan', LAN_PEER, 200],
    ['anywhere', INTERNET_PEER, 200],
  ] as const)('at level %s an admin session from %s gets %d', async (level, peer, status) => {
    const config = lanConfig({ adminAccess: level });
    const auth = new AuthService(config);
    const host = peer === LOOPBACK ? '127.0.0.1:8808' : '192.168.1.20:8808';

    const reply = await dispatch(config, auth, '/api/player-state', { peer, host, headers: adminHeaders(auth) });

    expect(reply.status).toBe(status);
    if (status === 403) expect(JSON.parse(reply.body).error).toContain(`"${level}"`);
  });

  it('does not count a loopback peer behind a same-host proxy as localhost', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await dispatch(config, auth, '/api/player-state', {
      host: '127.0.0.1:8808',
      headers: { ...adminHeaders(auth), 'x-forwarded-for': INTERNET_PEER },
    });

    expect(reply.status).toBe(403);
  });

  it('closes an admin stream when the session logs out', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = adminHeaders(auth);

    const stream = await dispatch(config, auth, '/api/visualizer', { host: '127.0.0.1:8808', headers });
    await dispatch(config, auth, '/api/auth/logout', { method: 'POST', host: '127.0.0.1:8808', headers });

    expect(stream.res.destroyed).toBe(true);
  });
});

describe('auth routes', () => {
  const login = (config: Config, auth: AuthService, password: unknown, options: RequestOptions = {}): Promise<Reply> =>
    dispatch(config, auth, '/api/auth/login', { method: 'POST', host: '127.0.0.1:8808', body: { password }, ...options });

  it('mints a session, sets the cookie and returns the CSRF token', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await login(config, auth, PASSWORD);

    expect(reply.status).toBe(200);
    const { csrfToken } = JSON.parse(reply.body) as { csrfToken: string };
    const cookie = setCookies(reply)[0] ?? '';
    expect(cookie).toMatch(/^ndmcp-web-8808=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+$/);
    const session = await dispatch(config, auth, '/api/auth/session', { host: '127.0.0.1:8808', headers: { cookie: cookie.split(';')[0] ?? '' } });
    expect(JSON.parse(session.body)).toEqual({
      mode: 'jukebox', role: 'admin', csrfToken, adminLoginAvailable: true, isLocal: true, yourAddress: LOOPBACK,
    });
  });

  it('signs out the guest session that the admin cookie replaces', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { cookie } = guestHeaders(auth);

    const reply = await login(config, auth, PASSWORD, { headers: { cookie: cookie ?? '' } });

    expect(reply.status).toBe(200);
    expect(auth.jukeboxStatus().guestCount).toBe(0);
  });

  it('answers every wrong password with the same message and throttles the next attempt', async () => {
    const config = lanConfig({ adminAccess: 'lan' });
    const auth = new AuthService(config);
    const fromLan = { peer: LAN_PEER, host: '192.168.1.20:8808' };

    const wrong = await login(config, auth, 'not the password', fromLan);
    const throttled = await login(config, auth, PASSWORD, fromLan);
    const local = await login(config, auth, PASSWORD);

    expect(wrong.status).toBe(401);
    expect(JSON.parse(wrong.body)).toEqual({ error: 'Wrong password' });
    expect(throttled.status).toBe(429);
    expect(throttled.headers['retry-after']).toBe('1');
    expect(local.status).toBe(200);
  });

  it('hides the login with 404 from a source outside the admin access level', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await login(config, auth, PASSWORD, { peer: LAN_PEER, host: '192.168.1.20:8808' });
    const session = await dispatch(config, auth, '/api/auth/session', { peer: '::ffff:192.168.1.50' });

    expect(reply.status).toBe(404);
    expect(JSON.parse(session.body)).toEqual({
      mode: 'jukebox', role: 'anonymous', adminLoginAvailable: false, isLocal: false, yourAddress: LAN_PEER,
    });
  });

  it('answers 503 and points to the settings page when no admin password is set', async () => {
    const config = lanConfig({ adminPasswordHash: null });

    const reply = await login(config, new AuthService(config), PASSWORD);

    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.body).error).toContain('settings page');
  });

  it('reports the open principal in mode none', async () => {
    const config = lanConfig({ mode: 'none' });

    const reply = await dispatch(config, new AuthService(config), '/api/auth/session', { peer: LAN_PEER });

    expect(JSON.parse(reply.body)).toEqual({ mode: 'none', role: 'open', adminLoginAvailable: false, isLocal: false, yourAddress: LAN_PEER });
  });

  // A same-host proxy connects from loopback, so its forwarding header keeps the request non-local.
  const LOCAL_FROM: RequestOptions = { host: '127.0.0.1:8808' };
  const SESSION_ROWS: { mode: 'none' | 'password' | 'jukebox'; visitor: string; from: RequestOptions; isLocal: boolean }[] = [
    { mode: 'none', visitor: 'a local browser', from: LOCAL_FROM, isLocal: true },
    { mode: 'none', visitor: 'a proxied browser', from: { ...LOCAL_FROM, headers: { 'x-forwarded-for': INTERNET_PEER } }, isLocal: false },
    { mode: 'password', visitor: 'a local admin', from: LOCAL_FROM, isLocal: true },
    { mode: 'password', visitor: 'a LAN admin', from: { peer: LAN_PEER }, isLocal: false },
    { mode: 'jukebox', visitor: 'a local admin', from: LOCAL_FROM, isLocal: true },
    { mode: 'jukebox', visitor: 'a LAN admin', from: { peer: LAN_PEER }, isLocal: false },
  ];

  it.each(SESSION_ROWS)('mode $mode, $visitor: the session reports isLocal $isLocal', async ({ mode, from, isLocal }) => {
    const config = lanConfig(mode === 'none' ? { mode, adminPasswordHash: null } : { mode, adminAccess: 'lan' });
    const auth = new AuthService(config);
    const headers = mode === 'none' ? from.headers : { ...from.headers, ...adminHeaders(auth) };

    const reply = await dispatch(config, auth, '/api/auth/session', { ...from, headers });

    expect(JSON.parse(reply.body)).toMatchObject({ role: mode === 'none' ? 'open' : 'admin', isLocal });
  });

  it('deletes the session on logout and expires the cookie', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = adminHeaders(auth);

    const logout = await dispatch(config, auth, '/api/auth/logout', { method: 'POST', host: '127.0.0.1:8808', headers });
    const after = await dispatch(config, auth, '/api/player-state', { host: '127.0.0.1:8808', headers });

    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie']).toMatch(/^ndmcp-web-8808=; .*Max-Age=0$/);
    expect(after.status).toBe(401);
  });
});

describe('jukebox join route', () => {
  const join = (config: Config, auth: AuthService, body: unknown, options: RequestOptions = {}): Promise<Reply> =>
    dispatch(config, auth, '/api/auth/join', { method: 'POST', peer: LAN_PEER, body, ...options });

  it('mints a guest session with a cookie that lasts as long as the longest key and a device cookie, marked noindex', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key, jukeboxCode } = auth.createJukeboxCode(2, false);

    const reply = await join(config, auth, { key, nickname: ' Ana ' });

    expect(reply.status).toBe(200);
    expect(reply.headers['x-robots-tag']).toBe('noindex');
    const [sessionCookie, deviceCookie] = setCookies(reply);
    expect(sessionCookie).toMatch(/^ndmcp-web-8808=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=7776000$/);
    expect(deviceCookie).toMatch(/^ndmcp-device-8808=[A-Za-z0-9_-]{22}; HttpOnly; SameSite=Strict; Path=\/api\/auth\/join; Max-Age=34560000$/);
    const body = JSON.parse(reply.body) as { csrfToken: string; joinedAt: number };
    expect(body).toEqual({
      role: 'guest', csrfToken: body.csrfToken, label: 'Guest 1', nickname: 'Ana', expiresAt: jukeboxCode.expiresAt, joinedAt: body.joinedAt,
    });
    expect(body.joinedAt).toBeTypeOf('number');
    const cookie = cookiePair(reply, 'ndmcp-web-8808');
    const session = await dispatch(config, auth, '/api/auth/session', { peer: LAN_PEER, headers: { cookie } });
    expect(JSON.parse(session.body)).toMatchObject({ role: 'guest', csrfToken: body.csrfToken });
  });

  it('answers a wrong key and a missing jukebox with one message and no cookie', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const noJukebox = await join(config, auth, { key: 'anything' });
    auth.createJukeboxCode(2, false);
    const wrong = await join(config, auth, { key: 'not-the-key' });

    for (const reply of [noJukebox, wrong]) {
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.body)).toEqual({ error: 'This jukebox code is not valid, closed or expired.' });
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
  });

  it.each([
    ['a Devanagari name with vowel signs', 'राज', 'राज'],
    ['a decomposed accent, stored composed', 'José', 'José'],
  ])('accepts %s as a nickname', async (_label, nickname, stored) => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);

    const reply = await join(config, auth, { key, nickname });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ nickname: stored });
  });

  it('refuses a nickname outside the allowed characters', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);

    const reply = await join(config, auth, { key, nickname: '<script>' });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toContain('nickname');
  });

  it('keeps the session and the stored nickname of a guest that joins again, with no new cookie', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const headers = guestHeaders(auth, key);

    const reply = await join(config, auth, { key, nickname: 'Bo' }, { headers });

    expect(reply.status).toBe(200);
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(JSON.parse(reply.body)).toMatchObject({ role: 'guest', label: 'Guest 1', nickname: null });
    expect(auth.jukeboxStatus().guestCount).toBe(1);
  });

  it('keeps an admin session instead of minting a guest one', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);

    const reply = await join(config, auth, { key }, { peer: LOOPBACK, host: '127.0.0.1:8808', headers: adminHeaders(auth) });

    expect(reply.status).toBe(200);
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(JSON.parse(reply.body)).toMatchObject({ role: 'admin', label: 'Host' });
    expect(auth.jukeboxStatus().guestCount).toBe(0);
  });

  it('refuses an admin a wrong or revoked key and keeps its admin session', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const admin = { peer: LOOPBACK, host: '127.0.0.1:8808', headers: adminHeaders(auth) };

    const wrong = await join(config, auth, { key: 'not-the-key' }, admin);
    auth.revokeJukeboxCode();
    const revoked = await join(config, auth, { key }, admin);
    const adminAgain = await dispatch(config, auth, '/api/auth/session', admin);

    for (const reply of [wrong, revoked]) {
      expect(reply.status).toBe(403);
      expect(reply.headers['set-cookie']).toBeUndefined();
      expect(JSON.parse(reply.body)).toEqual({ error: 'This jukebox code is not valid, closed or expired.' });
    }
    expect(JSON.parse(adminAgain.body)).toMatchObject({ role: 'admin' });
    expect(auth.jukeboxStatus().guestCount).toBe(0);
  });

  it('mints a guest session for an admin session outside the access level and ends the replaced admin session', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const admin = adminHeaders(auth);

    const reply = await join(config, auth, { key }, { headers: admin });
    const adminAgain = await dispatch(config, auth, '/api/auth/session', { peer: LOOPBACK, host: '127.0.0.1:8808', headers: admin });

    expect(reply.status).toBe(200);
    expect(setCookies(reply)[0]).toMatch(/^ndmcp-web-8808=/);
    expect(JSON.parse(reply.body)).toMatchObject({ role: 'guest', label: 'Guest 1' });
    expect(JSON.parse(adminAgain.body)).toMatchObject({ role: 'anonymous' });
  });

  it('leaves the admin session alone when a join outside the access level is refused', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    auth.createJukeboxCode(2, false);
    const admin = adminHeaders(auth);

    const reply = await join(config, auth, { key: 'wrong' }, { headers: admin });
    const adminAgain = await dispatch(config, auth, '/api/auth/session', { peer: LOOPBACK, host: '127.0.0.1:8808', headers: admin });

    expect(reply.status).toBe(403);
    expect(JSON.parse(adminAgain.body)).toMatchObject({ role: 'admin' });
  });

  it('spends no join from the network budget when an admitted guest joins again', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const guest = guestHeaders(auth, key);
    for (let i = 0; i < 10; i++) {
      expect((await join(config, auth, { key, nickname: `Bo ${String(i)}` }, { peer: INTERNET_PEER, headers: guest })).status).toBe(200);
    }

    const stranger = await join(config, auth, { key }, { peer: INTERNET_PEER });

    expect(stranger.status).toBe(200);
    expect(JSON.parse(stranger.body)).toMatchObject({ label: 'Guest 2' });
  });

  it('spends a join from the network budget when an admitted guest sends a wrong key', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const guest = guestHeaders(auth, key);
    for (let i = 0; i < 10; i++) {
      expect((await join(config, auth, { key: 'wrong' }, { peer: INTERNET_PEER, headers: guest })).status).toBe(403);
    }

    const throttled = await join(config, auth, { key: 'wrong' }, { peer: INTERNET_PEER, headers: guest });
    const rejoin = await join(config, auth, { key }, { peer: INTERNET_PEER, headers: guest });

    expect(throttled.status).toBe(429);
    expect(rejoin.status).toBe(200);
  });

  it('answers 403 once 100 guests hold the key', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    for (let i = 0; i < 100; i++) guestHeaders(auth, key);

    const reply = await join(config, auth, { key });

    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).error).toContain('full');
  });

  it('throttles an internet network after 10 joins with 429 and Retry-After', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    auth.createJukeboxCode(2, false);
    for (let i = 0; i < 10; i++) {
      expect((await join(config, auth, { key: 'wrong' }, { peer: INTERNET_PEER })).status).toBe(403);
    }

    const throttled = await join(config, auth, { key: 'wrong' }, { peer: INTERNET_PEER });
    const lan = await join(config, auth, { key: 'wrong' });

    expect(throttled.status).toBe(429);
    expect(throttled.headers['retry-after']).toBe('360');
    expect(lan.status).toBe(403);
  });

  it('gives each IPv6 LAN peer in one /64 its own join budget', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    auth.createJukeboxCode(2, false);
    for (let i = 0; i < 60; i++) {
      expect((await join(config, auth, { key: 'wrong' }, { peer: 'fd00:1:2:3::10' })).status).toBe(403);
    }

    const throttled = await join(config, auth, { key: 'wrong' }, { peer: 'fd00:1:2:3::10' });
    const neighbour = await join(config, auth, { key: 'wrong' }, { peer: 'fd00:1:2:3::11' });

    expect(throttled.status).toBe(429);
    expect(neighbour.status).toBe(403);
  });

  it('logs each join with the network key and never the key', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(2, false);
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await join(config, auth, { key });
    await join(config, auth, { key: 'wrong' });

    const lines = [...info.mock.calls, ...warn.mock.calls].map((call) => String(call[0]));
    expect(lines).toContain(`webui: jukebox join from ${LAN_PEER} as Guest 1`);
    expect(lines).toContain(`webui: jukebox join refused from ${LAN_PEER}`);
    expect(lines.join('\n')).not.toContain(key);
  });
});

describe('guest sessions at the gate', () => {
  it('refuses a guest POST without the right X-CSRF-Token', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { cookie } = guestHeaders(auth);

    const reply = await dispatch(config, auth, '/api/auth/logout', { method: 'POST', peer: LAN_PEER, headers: { cookie } });

    expect(reply.status).toBe(403);
  });

  it('signs the guest out on logout', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = guestHeaders(auth);

    await dispatch(config, auth, '/api/auth/logout', { method: 'POST', peer: LAN_PEER, headers });
    const after = await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers });

    expect(after.status).toBe(401);
    expect(auth.jukeboxStatus().guestCount).toBe(0);
  });

  it('serves internet peers while a jukebox code is active and refuses them after revocation', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = guestHeaders(auth);

    const during = await dispatch(config, auth, '/api/guest/events', { peer: INTERNET_PEER, headers });
    const admin = await dispatch(config, auth, '/api/player-state', { peer: INTERNET_PEER, headers: adminHeaders(auth) });
    auth.revokeJukeboxCode();
    const after = await dispatch(config, auth, '/api/auth/session', { peer: INTERNET_PEER });

    expect(during.status).toBe(200);
    expect(admin.status).toBe(403);
    expect(after.status).toBe(403);
    expect(JSON.parse(after.body).error).toContain('jukebox code');
  });

  it('ends a guest stream with the closed reason and answers 401 after the admin revokes the key', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = guestHeaders(auth);

    const stream = await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers });
    const revoke = await dispatch(config, auth, '/api/jukebox/key/revoke', { method: 'POST', host: '127.0.0.1:8808', headers: adminHeaders(auth) });
    const after = await dispatch(config, auth, '/api/cover/al-1', { peer: LAN_PEER, headers });

    expect(revoke.status).toBe(200);
    expect(JSON.parse(revoke.body)).toEqual({ ok: true, revoked: true });
    expect({ ended: stream.res.writableEnded, body: stream.res.body }).toEqual({ ended: true, body: 'event: ended\ndata: {"reason":"closed"}\n\n' });
    expect(after.status).toBe(401);
  });
});

describe('guest nickname route', () => {
  const NOW = 1_700_000_000_000;
  const NICKNAME_PATH = '/api/guest/nickname';

  /** The engine stub holds no queue, so a ledger record stands in for a queued song. */
  function watchedGuests(onChange: () => void): GuestQueue {
    const guests = new GuestQueue({ isRunning: () => false, onStateChange: () => () => undefined } as never);
    guests.watch(onChange);
    return guests;
  }

  function setup(): { config: Config; auth: AuthService; key: string } {
    const config = lanConfig();
    const auth = new AuthService(config, { now: () => NOW });
    return { config, auth, key: auth.createJukeboxCode(24, false).key };
  }

  function joinGuest(auth: AuthService, key: string, peer = LAN_PEER): { headers: Record<string, string>; sessionId: string } {
    const joined = auth.join(key, null, peer, null, newDeviceId());
    if (joined.kind !== 'joined') throw new Error(`join failed: ${joined.kind}`);
    return { headers: { cookie: `ndmcp-web-8808=${joined.token}`, 'x-csrf-token': joined.session.csrfToken }, sessionId: joined.session.id };
  }

  function rename(config: Config, auth: AuthService, headers: Record<string, string>, body: unknown, guests?: GuestQueue): Promise<Reply> {
    return dispatch(config, auth, NICKNAME_PATH, { method: 'POST', peer: LAN_PEER, headers, body, guests });
  }

  it('stores the trimmed nickname and shows it to the host list, the guest page and the guest songs', async () => {
    const { config, auth, key } = setup();
    const onChange = vi.fn();
    const guests = watchedGuests(onChange);
    const ana = joinGuest(auth, key);
    guests.ledger.record(7, { sessionId: ana.sessionId, song: { songId: 'so-1' }, guestLabel: 'Guest 1', addedAt: 0 });
    guests.ledger.record(8, { sessionId: 'session-other', song: { songId: 'so-2' }, guestLabel: 'Guest 2', addedAt: 0 });

    const reply = await rename(config, auth, ana.headers, { nickname: ' Ana ' }, guests);
    const list = await dispatch(config, auth, '/api/jukebox/guests', { host: '127.0.0.1:8808', headers: adminHeaders(auth), guests });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({ ok: true, nickname: 'Ana' });
    expect(auth.guestJukeboxFor(ana.sessionId)?.nickname).toBe('Ana');
    expect((JSON.parse(list.body) as { guests: Array<{ nickname: string }> }).guests[0]?.nickname).toBe('Ana');
    expect([guests.ledger.guestLabelOf(7), guests.ledger.guestLabelOf(8)]).toEqual(['Ana', 'Guest 2']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a blank nickname', { nickname: '   ' }],
    ['characters outside the allowed set', { nickname: '<script>' }],
    ['25 characters', { nickname: 'a'.repeat(25) }],
    ['a non-string nickname', { nickname: 7 }],
    ['a missing nickname', {}],
    ['an unknown field', { nickname: 'Ana', key: 'x' }],
  ])('answers 400 for %s and keeps the stored nickname', async (_label, body) => {
    const { config, auth, key } = setup();
    const ana = joinGuest(auth, key);

    const reply = await rename(config, auth, ana.headers, body);

    expect(reply.status).toBe(400);
    expect(auth.guestJukeboxFor(ana.sessionId)?.nickname).toBeNull();
  });

  it('refuses a POST without the right X-CSRF-Token', async () => {
    const { config, auth, key } = setup();
    const ana = joinGuest(auth, key);

    const reply = await rename(config, auth, { cookie: ana.headers['cookie']!, 'x-csrf-token': 'wrong' }, { nickname: 'Ana' });

    expect(reply.status).toBe(403);
    expect(auth.guestJukeboxFor(ana.sessionId)?.nickname).toBeNull();
  });

  it('refuses an admin session and an anonymous request', async () => {
    const { config, auth } = setup();

    const admin = await dispatch(config, auth, NICKNAME_PATH, { method: 'POST', host: '127.0.0.1:8808', headers: adminHeaders(auth), body: { nickname: 'Ana' } });
    const anonymous = await rename(config, auth, {}, { nickname: 'Ana' });

    expect(admin.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it('allows 10 changes an hour per session, then answers 429 with Retry-After and keeps the last name', async () => {
    const { config, auth, key } = setup();
    const ana = joinGuest(auth, key);
    const bo = joinGuest(auth, key, '192.168.1.60');
    for (let i = 0; i < 10; i++) {
      expect((await rename(config, auth, ana.headers, { nickname: `Ana ${String(i)}` })).status).toBe(200);
    }

    const same = await rename(config, auth, ana.headers, { nickname: 'Ana 9' });
    const limited = await rename(config, auth, ana.headers, { nickname: 'Ana 10' });
    const other = await rename(config, auth, bo.headers, { nickname: 'Bo' });

    expect(same.status).toBe(200);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('360');
    expect(auth.guestJukeboxFor(ana.sessionId)?.nickname).toBe('Ana 9');
    expect(other.status).toBe(200);
  });

  it('spends no budget on a name the guest already holds', async () => {
    const { config, auth, key } = setup();
    const ana = joinGuest(auth, key);
    for (let i = 0; i < 12; i++) {
      expect((await rename(config, auth, ana.headers, { nickname: 'Ana' })).status).toBe(200);
    }

    expect((await rename(config, auth, ana.headers, { nickname: 'Ana B' })).status).toBe(200);
  });
});

describe('jukebox code routes', () => {
  interface CodeView {
    active: boolean;
    expiresAt: number | null;
    guestCount: number;
    links: { lan: Array<{ label: string; url: string; qrSvg: string }>; internet: { url: string; qrSvg: string } | null };
    problem: string | null;
  }

  const ONE_LAN = { 'Wi-Fi': [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '192.168.1.20/24' }] } as const;

  it('returns join links with a QR code, shows them again, and the status never carries the key', async () => {
    osStub.interfaces = ONE_LAN as never;
    const base = lanConfig();
    const config = makeTestConfig({ webui: { ...base.webui, publicUrl: 'http://jukebox.example.org:8808' } });
    const auth = new AuthService(config);
    const headers = adminHeaders(auth);
    broadcastNow.mockClear();

    const created = await dispatch(config, auth, '/api/jukebox/key', {
      method: 'POST', host: '127.0.0.1:8808', headers, body: { lifetimeHours: 24, signOutGuests: false },
    });

    expect(created.status).toBe(200);
    const body = JSON.parse(created.body) as CodeView & { joinUrls: Array<{ label: string; url: string; qrSvg: string }> };
    const internet = body.links.internet;
    expect(internet?.url).toMatch(/^http:\/\/jukebox\.example\.org:8808\/guest#k=[A-Za-z0-9_-]{43}$/);
    expect(broadcastNow).toHaveBeenCalledTimes(1);
    expect(internet?.qrSvg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    const key = internet?.url.split('#k=')[1] ?? '';
    expect(body.links.lan).toEqual([{ label: 'Wi-Fi · 192.168.1.20', url: `http://192.168.1.20:8808/guest#k=${key}`, qrSvg: expect.stringMatching(/^<svg /) as unknown }]);
    expect(auth.join(key, null, LAN_PEER, null, newDeviceId()).kind).toBe('joined');

    const again = await dispatch(config, auth, '/api/jukebox/code', { host: '127.0.0.1:8808', headers });
    expect(again.status).toBe(200);
    expect(again.headers['cache-control']).toBe('no-store');
    const againView = JSON.parse(again.body) as CodeView;
    const { joinUrls, ...createdView } = body;
    expect(joinUrls).toEqual([{ label: 'Internet', ...internet }, ...body.links.lan]);
    expect(againView).toEqual({ ...createdView, guestCount: 1 });

    const status = await dispatch(config, auth, '/api/jukebox/key', { host: '127.0.0.1:8808', headers });
    expect(status.body).not.toContain(key);
    expect(JSON.parse(status.body)).toMatchObject({ active: true, expiresAt: body.expiresAt, guestCount: 1 });
  });

  it('shows no internet link without a public URL, and no links while the jukebox is closed', async () => {
    osStub.interfaces = ONE_LAN as never;
    const config = lanConfig();
    const auth = new AuthService(config);
    const headers = adminHeaders(auth);

    const closed = await dispatch(config, auth, '/api/jukebox/code', { host: '127.0.0.1:8808', headers });
    auth.createJukeboxCode(24, false);
    const open = await dispatch(config, auth, '/api/jukebox/code', { host: '127.0.0.1:8808', headers });

    expect(JSON.parse(closed.body)).toEqual({ active: false, expiresAt: null, guestCount: 0, links: { lan: [], internet: null }, problem: null });
    const view = JSON.parse(open.body) as CodeView;
    expect(view.links.internet).toBeNull();
    expect(view.links.lan.map((link) => link.label)).toEqual(['Wi-Fi · 192.168.1.20']);
    expect(view.problem).toBeNull();
  });

  it('names the loopback bind as the cause when a live code has no link', async () => {
    osStub.interfaces = ONE_LAN as never;
    const config = makeTestConfig({ webui: { ...lanConfig().webui, host: '127.0.0.1', expose: false } });
    const auth = new AuthService(config);
    auth.createJukeboxCode(24, false);

    const reply = await dispatch(config, auth, '/api/jukebox/code', { host: '127.0.0.1:8808', headers: adminHeaders(auth) });

    const view = JSON.parse(reply.body) as CodeView;
    expect(view.active).toBe(true);
    expect(view.links).toEqual({ lan: [], internet: null });
    expect(view.problem).toContain('Turn on Expose on LAN');
  });

  it('names the missing LAN address as the cause when a live code has no link on a LAN bind', async () => {
    osStub.interfaces = { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
    const config = lanConfig();
    const auth = new AuthService(config);
    auth.createJukeboxCode(24, false);

    const reply = await dispatch(config, auth, '/api/jukebox/code', { host: '127.0.0.1:8808', headers: adminHeaders(auth) });

    expect((JSON.parse(reply.body) as CodeView).problem).toContain('No LAN IPv4 address was found');
  });

  it.each([0, 2161, 1.5, '24'])('refuses the lifetime %j', async (lifetimeHours) => {
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await dispatch(config, auth, '/api/jukebox/key', {
      method: 'POST', host: '127.0.0.1:8808', headers: adminHeaders(auth), body: { lifetimeHours },
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toContain('lifetimeHours');
  });

  it('refuses a key with 409 on a loopback bind, where no guest can reach the player', async () => {
    const config = makeTestConfig({ webui: { ...lanConfig().webui, host: '127.0.0.1', expose: false } });
    const auth = new AuthService(config);

    const reply = await dispatch(config, auth, '/api/jukebox/key', {
      method: 'POST', host: '127.0.0.1:8808', headers: adminHeaders(auth), body: { lifetimeHours: 1 },
    });

    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body).error).toContain('Turn on Expose on LAN');
    expect(auth.hasJukeboxCode()).toBe(false);
  });

  it('refuses a key with 409 on a LAN bind with no LAN IPv4 address and no public URL', async () => {
    osStub.interfaces = { lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] };
    const config = lanConfig();
    const auth = new AuthService(config);

    const reply = await dispatch(config, auth, '/api/jukebox/key', {
      method: 'POST', host: '127.0.0.1:8808', headers: adminHeaders(auth), body: { lifetimeHours: 1 },
    });

    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body).error).toBe(
      'No LAN IPv4 address was found. Connect this computer to the network, or set webui.publicUrl in navidrome-config.',
    );
    expect(auth.hasJukeboxCode()).toBe(false);
  });
});

describe('guest management routes', () => {
  const OTHER_LAN_PEER = '192.168.1.60';

  /** No mpv is attached by default, so a ban removes no queued song and never reaches the live player. */
  function detachedGuests(running = false): GuestQueue {
    const engine = {
      getQueue: () => Promise.resolve([]),
      isRunning: () => running,
      onStateChange: () => () => undefined,
    };
    return new GuestQueue(engine as never, () => 3);
  }

  function joinAs(auth: AuthService, key: string, peer: string, nickname: string | null = null): { headers: Record<string, string>; sessionId: string } {
    const joined = auth.join(key, nickname, peer, null, newDeviceId());
    if (joined.kind !== 'joined') throw new Error(`join failed: ${joined.kind}`);
    return { headers: { cookie: `ndmcp-web-8808=${joined.token}`, 'x-csrf-token': joined.session.csrfToken }, sessionId: joined.session.id };
  }

  function setup(): { config: Config; auth: AuthService; admin: Record<string, string>; key: string; guests: GuestQueue } {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(24, false);
    return { config, auth, admin: adminHeaders(auth), key, guests: detachedGuests() };
  }

  function post(config: Config, auth: AuthService, path: string, admin: Record<string, string>, body: unknown, guests?: GuestQueue): Promise<Reply> {
    return dispatch(config, auth, path, { method: 'POST', host: '127.0.0.1:8808', headers: admin, body, guests });
  }

  it('lists each guest with its address, the guests and admins sharing it and its unplayed songs', async () => {
    const { config, auth, admin, key } = setup();
    const guests = detachedGuests(true);
    const ana = joinAs(auth, key, LAN_PEER, 'Ana');
    joinAs(auth, key, LAN_PEER);
    joinAs(auth, key, OTHER_LAN_PEER);
    auth.createSession(OTHER_LAN_PEER);
    guests.ledger.record(7, { sessionId: ana.sessionId, song: { songId: 'so-1', title: 'Song One', artist: 'Band' }, guestLabel: 'Ana', addedAt: 0 });

    const reply = await dispatch(config, auth, '/api/jukebox/guests', { host: '127.0.0.1:8808', headers: admin, guests });

    expect(reply.status).toBe(200);
    const body = JSON.parse(reply.body) as { guests: Array<Record<string, unknown>> };
    expect(body.guests).toHaveLength(3);
    expect(body.guests[0]).toEqual({
      sessionId: ana.sessionId,
      label: 'Guest 1',
      nickname: 'Ana',
      online: true,
      joinedAt: expect.any(Number),
      lastSeenAt: expect.any(Number),
      networkKey: LAN_PEER,
      addressClass: 'lan',
      sharedCount: 1,
      adminShares: false,
      songs: [{ title: 'Song One', artist: 'Band' }],
    });
    expect(body.guests.map((guest) => guest['sharedCount'])).toEqual([1, 1, 0]);
    expect(body.guests.map((guest) => guest['adminShares'])).toEqual([false, false, true]);
  });

  it('lists no songs for a guest while no mpv is attached', async () => {
    const { config, auth, admin, key, guests } = setup();
    const ana = joinAs(auth, key, LAN_PEER);
    guests.ledger.record(7, { sessionId: ana.sessionId, song: { songId: 'so-1' }, guestLabel: 'Guest 1', addedAt: 0 });

    const reply = await dispatch(config, auth, '/api/jukebox/guests', { host: '127.0.0.1:8808', headers: admin, guests });

    expect((JSON.parse(reply.body) as { guests: Array<{ songs: unknown[] }> }).guests[0]?.songs).toEqual([]);
  });

  it('signs a guest out and keeps its songs, and the guest can join again', async () => {
    const { config, auth, admin, key, guests } = setup();
    const ana = joinAs(auth, key, LAN_PEER);
    guests.ledger.record(7, { sessionId: ana.sessionId, song: { songId: 'so-1' }, guestLabel: 'Guest 1', addedAt: 0 });
    const info = vi.spyOn(logger, 'info');

    const reply = await post(config, auth, '/api/jukebox/guests/remove', admin, { sessionId: ana.sessionId }, guests);
    const after = await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers: ana.headers });

    expect(reply.status).toBe(200);
    expect(after.status).toBe(401);
    expect(guests.ledger.unplayedEntryIds(ana.sessionId)).toEqual([7]);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/Guest 1 \(192\.168\.1\.50\) was signed out/));
    expect(joinAs(auth, key, LAN_PEER).sessionId).not.toBe(ana.sessionId);
  });

  it('answers 404 for a guest that is no longer signed in and a ban that is gone', async () => {
    const { config, auth, admin } = setup();

    expect((await post(config, auth, '/api/jukebox/guests/remove', admin, { sessionId: 'gone' })).status).toBe(404);
    expect((await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: 'gone', networkBanHours: 0 })).status).toBe(404);
    expect((await post(config, auth, '/api/jukebox/bans/remove', admin, { banId: 'gone' })).status).toBe(404);
  });

  it.each([2, -1, '24', null])('refuses the network ban duration %j', async (networkBanHours) => {
    const { config, auth, admin, key } = setup();
    const ana = joinAs(auth, key, LAN_PEER);

    const reply = await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: ana.sessionId, networkBanHours });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toContain('networkBanHours');
  });

  it('bans a guest, then refuses every request from its network with Access denied, static files included', async () => {
    const { config, auth, admin, key, guests } = setup();
    const ana = joinAs(auth, key, LAN_PEER, 'Ana');
    const bo = joinAs(auth, key, OTHER_LAN_PEER);
    const stream = await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers: ana.headers });
    const info = vi.spyOn(logger, 'info');

    const reply = await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: ana.sessionId, networkBanHours: 24 }, guests);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ ok: true, songsRemoved: 0, songsStayed: 0, bans: [{ kind: 'guest' }, { kind: 'network', networkKey: LAN_PEER }] });
    expect({ ended: stream.res.writableEnded, body: stream.res.body }).toEqual({ ended: true, body: 'event: ended\ndata: {"reason":"removed"}\n\n' });
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/Guest 1 \(192\.168\.1\.50\) was banned/));
    for (const path of ['/admin', '/api/auth/session', '/guest']) {
      const refused = await dispatch(config, auth, path, { peer: LAN_PEER });
      expect(refused.status).toBe(403);
      expect(JSON.parse(refused.body)).toEqual({ error: 'Access denied' });
    }
    expect((await dispatch(config, auth, '/api/guest/events', { peer: OTHER_LAN_PEER, headers: bo.headers })).status).toBe(200);
    expect((await dispatch(config, auth, '/admin', { host: '127.0.0.1:8808' })).status).toBe(200);
  });

  it('refuses a network ban on a loopback guest with 400, since no network ban blocks this computer', async () => {
    const { config, auth, admin, key } = setup();
    const local = joinAs(auth, key, LOOPBACK);

    const reply = await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: local.sessionId, networkBanHours: 1 });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toContain('no effect');
    expect(auth.listGuests()).toHaveLength(1);
  });

  it("refuses a network ban on the admin's own network with 400, so the admin keeps access", async () => {
    const config = lanConfig({ adminAccess: 'lan' });
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(24, false);
    const { token, session } = auth.createSession(OTHER_LAN_PEER);
    const remoteAdmin = { cookie: `ndmcp-web-8808=${token}`, 'x-csrf-token': session.csrfToken };
    const neighbour = joinAs(auth, key, OTHER_LAN_PEER);

    const reply = await dispatch(config, auth, '/api/jukebox/guests/ban', {
      method: 'POST', peer: OTHER_LAN_PEER, headers: remoteAdmin, body: { sessionId: neighbour.sessionId, networkBanHours: 24 },
    });

    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.body).error).toContain('lock you out');
    expect(auth.isNetworkBanned(OTHER_LAN_PEER)).toBe(false);
    expect(auth.listGuests()).toHaveLength(1);
  });

  it('counts the queued songs that stay and logs it when no mpv is attached', async () => {
    const { config, auth, admin, key, guests } = setup();
    const ana = joinAs(auth, key, LAN_PEER);
    guests.ledger.record(7, { sessionId: ana.sessionId, song: { songId: 'so-1' }, guestLabel: 'Guest 1', addedAt: 0 });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const reply = await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: ana.sessionId, networkBanHours: 0 }, guests);

    expect(JSON.parse(reply.body)).toMatchObject({ ok: true, songsRemoved: 0, songsStayed: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no player is attached'));
  });

  it('answers null song counts when the queue removal fails, after the ban landed', async () => {
    const { config, auth, admin, key } = setup();
    const ana = joinAs(auth, key, LAN_PEER);
    const failing = { removeGuestSongs: () => Promise.reject(new Error('ipc closed')) } as unknown as GuestQueue;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const reply = await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: ana.sessionId, networkBanHours: 0 }, failing);

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ ok: true, songsRemoved: null, songsStayed: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ipc closed'));
    expect(auth.listBans().map((ban) => ban.kind)).toEqual(['guest']);
  });

  it('lists the bans and lifts one, which lets the network back in', async () => {
    const { config, auth, admin, key, guests } = setup();
    const ana = joinAs(auth, key, LAN_PEER);
    await post(config, auth, '/api/jukebox/guests/ban', admin, { sessionId: ana.sessionId, networkBanHours: 1 }, guests);
    const info = vi.spyOn(logger, 'info');

    const listed = await dispatch(config, auth, '/api/jukebox/bans', { host: '127.0.0.1:8808', headers: admin });
    const bans = (JSON.parse(listed.body) as { bans: Array<{ id: string; kind: string }> }).bans;
    const network = bans.find((ban) => ban.kind === 'network');
    const lifted = await post(config, auth, '/api/jukebox/bans/remove', admin, { banId: network?.id });

    expect(bans.map((ban) => ban.kind)).toEqual(['guest', 'network']);
    expect(lifted.status).toBe(200);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/network ban on Guest 1 \(192\.168\.1\.50\) was lifted/));
    expect((await dispatch(config, auth, '/admin', { peer: LAN_PEER })).status).toBe(200);
  });
});

describe('browser ban', () => {
  const DEVICE_COOKIE = 'ndmcp-device-8808';
  const BANNED = { error: 'The host removed you from the jukebox.' };
  const ADMIN = { host: '127.0.0.1:8808' };

  function join(config: Config, auth: AuthService, key: string, cookie?: string): Promise<Reply> {
    return dispatch(config, auth, '/api/auth/join', { method: 'POST', peer: LAN_PEER, body: { key }, headers: cookie === undefined ? {} : { cookie } });
  }

  function adminPost(config: Config, auth: AuthService, admin: Record<string, string>, path: string, body: unknown): Promise<Reply> {
    return dispatch(config, auth, path, { method: 'POST', ...ADMIN, headers: admin, body });
  }

  /** Joins through the route, then bans that guest through the route, and returns the banned browser's device cookie. */
  async function joinAndBan(config: Config, auth: AuthService, admin: Record<string, string>, key: string): Promise<{ device: string; banReply: Reply }> {
    const joined = await join(config, auth, key);
    const device = cookiePair(joined, DEVICE_COOKIE);
    const [{ session }] = auth.listGuests() as [GuestStatus];
    const banReply = await adminPost(config, auth, admin, '/api/jukebox/guests/ban', { sessionId: session.id, networkBanHours: 0 });
    expect(banReply.status).toBe(200);
    return { device, banReply };
  }

  function setup(): { config: Config; auth: AuthService; admin: Record<string, string>; key: string } {
    const config = lanConfig();
    const auth = new AuthService(config);
    const { key } = auth.createJukeboxCode(24, false);
    return { config, auth, admin: adminHeaders(auth), key };
  }

  it('keeps the device cookie a browser sends, and stores it on the guest session', async () => {
    const { config, auth, key } = setup();
    const deviceId = newDeviceId();

    const reply = await join(config, auth, key, `${DEVICE_COOKIE}=${deviceId}`);

    expect(reply.status).toBe(200);
    expect(setCookies(reply).map((cookie) => cookie.split('=', 1)[0])).toEqual(['ndmcp-web-8808']);
    expect(auth.listGuests().map(({ session }) => session.deviceId)).toEqual([deviceId]);
  });

  it('sends a kept guest without a device cookie the one its session holds', async () => {
    const { config, auth, key } = setup();
    const first = await join(config, auth, key);
    const device = cookiePair(first, DEVICE_COOKIE);

    const kept = await join(config, auth, key, cookiePair(first, 'ndmcp-web-8808'));

    expect(kept.status).toBe(200);
    expect(setCookies(kept).map((cookie) => cookie.split(';')[0])).toEqual([device]);
    expect(auth.jukeboxStatus().guestCount).toBe(1);
  });

  it('refuses the banned browser with the same key and with both forms of a new key, before minting a session', async () => {
    const { config, auth, admin, key } = setup();
    const { device } = await joinAndBan(config, auth, admin, key);

    const sameKey = await join(config, auth, key, device);
    const keptGuestsKey = auth.createJukeboxCode(24, false).key;
    const keptGuests = await join(config, auth, keptGuestsKey, device);
    const signedOutKey = auth.createJukeboxCode(24, true).key;
    const signedOut = await join(config, auth, signedOutKey, device);

    for (const reply of [sameKey, keptGuests, signedOut]) {
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.body)).toEqual(BANNED);
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
    expect(auth.jukeboxStatus().guestCount).toBe(0);
  });

  it('admits a browser with no device cookie, and the banned browser once the ban is lifted', async () => {
    const { config, auth, admin, key } = setup();
    const { device } = await joinAndBan(config, auth, admin, key);

    const otherBrowser = await join(config, auth, key);
    const [ban] = auth.listBans();
    const lifted = await adminPost(config, auth, admin, '/api/jukebox/bans/remove', { banId: ban?.id });
    const again = await join(config, auth, key, device);

    expect(otherBrowser.status).toBe(200);
    expect(lifted.status).toBe(200);
    expect(again.status).toBe(200);
    expect(JSON.parse(again.body)).toMatchObject({ role: 'guest' });
  });

  it('keeps an admin session on the guest page when its browser holds a banned device cookie', async () => {
    const { config, auth, admin, key } = setup();
    const { device } = await joinAndBan(config, auth, admin, key);

    const reply = await dispatch(config, auth, '/api/auth/join', {
      method: 'POST', ...ADMIN, peer: LOOPBACK, body: { key }, headers: { ...admin, cookie: `${admin['cookie'] ?? ''}; ${device}` },
    });

    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({ role: 'admin' });
  });

  it('logs the refusal with the network key, and keeps the device id out of every log line and response', async () => {
    const { config, auth, admin, key } = setup();
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const { device, banReply } = await joinAndBan(config, auth, admin, key);
    const deviceId = device.slice(`${DEVICE_COOKIE}=`.length);

    const refused = await join(config, auth, key, device);
    const listed = await dispatch(config, auth, '/api/jukebox/bans', { ...ADMIN, headers: admin });
    const guests = await dispatch(config, auth, '/api/jukebox/guests', { ...ADMIN, headers: admin });

    const lines = [...info.mock.calls, ...warn.mock.calls].map((call) => call.map(String).join(' '));
    expect(lines).toContain(`webui: jukebox join refused from ${LAN_PEER}, since the host banned this browser`);
    expect(auth.listBans()[0]?.deviceId).toBe(deviceId);
    expect([refused.status, listed.status, guests.status]).toEqual([403, 200, 200]);
    for (const text of [...lines, banReply.body, refused.body, listed.body, guests.body]) expect(text).not.toContain(deviceId);
    expect(JSON.parse(listed.body)).toMatchObject({ bans: [{ kind: 'guest' }] });
  });
});

describe('stream caps', () => {
  const STREAM_HOST = '127.0.0.1:8808';
  // A stream's source address is its scope, so each distinct 10.x address has its own cap.
  const uniquePeer = (n: number): string => `10.1.${String(n >> 8)}.${String(n & 255)}`;

  it('closes the oldest event stream of an admin session when a fourth opens, and spares its other routes', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const server = buildServer(config, auth);
    const headers = adminHeaders(auth);
    const open = (path: string): Promise<Reply> => dispatch(config, auth, path, { host: STREAM_HOST, headers, server });

    const visualizer = await open('/api/visualizer');
    const events = [await open('/api/events'), await open('/api/events'), await open('/api/events')];
    expect(events.map((stream) => stream.res.writableEnded)).toEqual([false, false, false]);
    events.push(await open('/api/events'));

    expect(events.map((stream) => stream.res.writableEnded)).toEqual([true, false, false, false]);
    expect(events[3]?.status).toBe(200);
    expect(visualizer.res.writableEnded).toBe(false);
  });

  it('closes the oldest guest stream of a guest session when a fourth opens', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const server = buildServer(config, auth);
    const headers = guestHeaders(auth);
    const open = (path: string): Promise<Reply> => dispatch(config, auth, path, { peer: LAN_PEER, headers, server });

    const streams = [];
    for (let i = 0; i < 4; i += 1) streams.push(await open('/api/guest/events'));
    const visualizer = await open('/api/visualizer');

    expect(streams.map((stream) => stream.res.writableEnded)).toEqual([true, false, false, false]);
    expect(visualizer.res.writableEnded).toBe(false);
  });

  it('counts the sessions of one address separately', async () => {
    const config = lanConfig();
    const auth = new AuthService(config);
    const server = buildServer(config, auth);
    const ana = guestHeaders(auth);
    const bo = guestHeaders(auth);

    const anaStreams = [];
    for (let i = 0; i < 3; i += 1) anaStreams.push(await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers: ana, server }));
    for (let i = 0; i < 3; i += 1) await dispatch(config, auth, '/api/guest/events', { peer: LAN_PEER, headers: bo, server });

    expect(anaStreams.some((stream) => stream.res.writableEnded)).toBe(false);
  });

  it('closes the oldest stream of an address in mode none once it holds more than six across routes', async () => {
    const config = lanConfig({ mode: 'none' });
    const auth = new AuthService(config);
    const server = buildServer(config, auth);
    const open = (path: string, peer: string): Promise<Reply> => dispatch(config, auth, path, { peer, server });

    const otherAddress = await open('/api/events', '192.168.1.60');
    const streams = [];
    for (const path of ['/api/events', '/api/events', '/api/events', '/api/visualizer', '/api/visualizer', '/api/visualizer']) {
      streams.push(await open(path, LAN_PEER));
    }
    expect(streams.some((stream) => stream.res.writableEnded)).toBe(false);
    streams.push(await open('/api/events', LAN_PEER));

    expect(streams.map((stream) => stream.res.writableEnded)).toEqual([true, false, false, false, false, false, false]);
    expect(otherAddress.res.writableEnded).toBe(false);
    expect(streams[0]?.res.body).toBe(`event: ${STREAM_EVICTED_EVENT}\ndata: {}\n\n`);
  });

  it('ends a stream over the server-wide cap with a retry interval, then admits one after a stream closes', async () => {
    const config = lanConfig({ mode: 'none' });
    const auth = new AuthService(config);
    const server = buildServer(config, auth);
    const open = (n: number): Promise<Reply> => dispatch(config, auth, '/api/events', { peer: uniquePeer(n), server });
    const refusedFrame = `retry: ${String(REFUSED_STREAM_RETRY_MS)}\n\n`;

    const streams: Reply[] = [];
    for (let n = 0; n < MAX_OPEN_STREAMS; n += 1) streams.push(await open(n));
    const refused = await open(MAX_OPEN_STREAMS);

    expect(streams.every((stream) => stream.status === 200 && !stream.res.writableEnded)).toBe(true);
    expect(refused.status).toBe(200);
    expect(refused.res.writableEnded).toBe(true);
    expect(refused.res.body).toBe('');
    expect(refused.res.written).toEqual([refusedFrame]);

    streams[0]?.res.emit('close');
    const admitted = await open(MAX_OPEN_STREAMS + 1);
    expect(admitted.res.writableEnded).toBe(false);
    expect(admitted.res.written).not.toContain(refusedFrame);
  });
});
