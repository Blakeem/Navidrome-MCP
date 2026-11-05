import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../../../src/config.js';
import { logger, redact } from '../../../src/utils/logger.js';
import { hashPassword, randomToken, verifyPassword } from '../../../src/utils/secrets.js';
import { AuthService } from '../../../src/webui/auth/auth-service.js';
import type { QueuedNames } from '../../../src/webui/jukebox/jukebox-names.js';
import { getAuthStorePath, readAuthFile, readAuthFileWithStatus, writeAuthFile, type AdminSession, type SessionRecord } from '../../../src/webui/auth/auth-store.js';
import { deviceCookieName, readCookieValues, sessionCookieName } from '../../../src/webui/auth/session-cookie.js';
import { makeTestConfig } from '../../helpers/test-config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const PORT = makeTestConfig().webui.port;
const PASSWORD = 'correct horse battery';
const NO_QUEUED_NAMES = (): QueuedNames => ({ host: [], guest: [] });

function newDeviceId(): string {
  return randomToken(16);
}
let adminHash = '';
let otherHash = '';

beforeAll(async () => {
  adminHash = await hashPassword(PASSWORD);
  otherHash = await hashPassword('another password here');
});

function jukeboxConfig(overrides: Partial<Config['webui']['auth']> = {}, tls = false): Config {
  const base = makeTestConfig();
  return makeTestConfig({
    webui: {
      ...base.webui,
      tls: tls ? { certPath: '/c.pem', keyPath: '/k.pem' } : { certPath: null, keyPath: null },
      auth: { mode: 'jukebox', adminPasswordHash: adminHash, adminAccess: 'localhost', ...overrides },
    },
  });
}

function clock(start = Date.UTC(2026, 0, 1)): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

function requestWithCookie(cookie: string | undefined): IncomingMessage {
  return { headers: cookie === undefined ? {} : { cookie }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function cookieFor(service: AuthService, token: string): string {
  const name = service.sessionCookie(token).split('=', 1)[0] ?? '';
  return `${name}=${token}`;
}

// end() leaves the stream open, as a real one stays open until its frames flush.
class FakeStream extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  readonly written: string[] = [];
  end(chunk: string): this {
    this.written.push(chunk);
    this.writableEnded = true;
    return this;
  }
  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }
}

function endedFrame(reason: string): string {
  return `event: ended
data: ${JSON.stringify({ reason })}

`;
}

let dir: string;
let savedPath: string | undefined;

beforeEach(() => {
  savedPath = process.env['NAVIDROME_CONFIG_PATH'];
  dir = mkdtempSync(join(tmpdir(), 'nd-auth-'));
  process.env['NAVIDROME_CONFIG_PATH'] = join(dir, 'settings.json');
});

afterEach(() => {
  if (savedPath === undefined) delete process.env['NAVIDROME_CONFIG_PATH'];
  else process.env['NAVIDROME_CONFIG_PATH'] = savedPath;
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('session cookie', () => {
  it('names the cookie per port, with the __Host- prefix over HTTPS', () => {
    expect(sessionCookieName(8808, false)).toBe('ndmcp-web-8808');
    expect(sessionCookieName(8808, true)).toBe('__Host-ndmcp-web-8808');
    expect(sessionCookieName(8809, true)).not.toBe(sessionCookieName(8808, true));
  });

  it('sets HttpOnly, SameSite=Strict and Path=/, and Secure only over HTTPS', () => {
    const http = new AuthService(jukeboxConfig()).sessionCookie('id.secret');
    const https = new AuthService(jukeboxConfig({}, true)).sessionCookie('id.secret');

    expect(http).toBe(`ndmcp-web-8808=id.secret; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(30 * 24 * 60 * 60)}`);
    expect(https).toMatch(/^__Host-ndmcp-web-8808=id\.secret; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure$/);
  });

  it('names the device cookie per port with no prefix, scopes it to the join route for 400 days, and adds Secure only over HTTPS', () => {
    const http = new AuthService(jukeboxConfig()).deviceCookie('device-id');
    const https = new AuthService(jukeboxConfig({}, true)).deviceCookie('device-id');

    expect(deviceCookieName(8808)).toBe('ndmcp-device-8808');
    expect(http).toBe(`ndmcp-device-8808=device-id; HttpOnly; SameSite=Strict; Path=/api/auth/join; Max-Age=${String(400 * 24 * 60 * 60)}`);
    expect(https).toBe(`${http}; Secure`);
  });

  it('keeps the first well-formed device cookie, and mints a new id for a missing or malformed one', () => {
    const service = new AuthService(jukeboxConfig());
    const id = newDeviceId();

    expect(service.deviceOf(requestWithCookie(`ndmcp-device-8808=forged; ndmcp-device-8808=${id}`))).toEqual({ id, presented: true });
    for (const cookie of [undefined, 'ndmcp-device-8808=forged', `ndmcp-device-8808=${id}x`, `ndmcp-device-8809=${id}`]) {
      const device = service.deviceOf(requestWithCookie(cookie));
      expect(device.presented).toBe(false);
      expect(device.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(device.id).not.toBe(id);
    }
  });

  it('reads every value of the named cookie and ignores other names', () => {
    expect(readCookieValues('a=1; ndmcp-web-8808=x.y; ndmcp-web-8808=z.w; ndmcp-web-80=q', 'ndmcp-web-8808')).toEqual(['x.y', 'z.w']);
    expect(readCookieValues(undefined, 'ndmcp-web-8808')).toEqual([]);
  });
});

describe('AuthService sessions', () => {
  it('mints a token whose secret only the cookie carries and finds the session by it', () => {
    const service = new AuthService(jukeboxConfig());
    const { token, session } = service.createSession('127.0.0.1');
    const [id, secret] = token.split('.');

    expect(id).toBe(session.id);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(readAuthFile(PORT))).not.toContain(secret);
    expect(service.findSession(requestWithCookie(cookieFor(service, token)))).toBe(session);
  });

  it('refuses a wrong secret, an unknown id, a malformed token and a missing cookie', () => {
    const service = new AuthService(jukeboxConfig());
    const { session } = service.createSession('127.0.0.1');

    for (const token of [`${session.id}.wrong`, 'unknown.secret', 'no-separator', `.${session.id}`]) {
      expect(service.findSession(requestWithCookie(`ndmcp-web-8808=${token}`))).toBeNull();
    }
    expect(service.findSession(requestWithCookie(undefined))).toBeNull();
  });

  it('skips a stale cookie of the same name that comes first', () => {
    const service = new AuthService(jukeboxConfig());
    const { token, session } = service.createSession('127.0.0.1');

    expect(service.findSession(requestWithCookie(`ndmcp-web-8808=stale.value; ndmcp-web-8808=${token}`))).toBe(session);
  });

  it('expires a session after 7 idle days and slides the expiry on use', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { token, session } = service.createSession('127.0.0.1');
    const req = requestWithCookie(cookieFor(service, token));

    time.advance(6 * DAY_MS);
    service.touch(session, '127.0.0.1');
    time.advance(6 * DAY_MS);
    expect(service.findSession(req)).toBe(session);
    time.advance(DAY_MS + 1);
    expect(service.findSession(req)).toBeNull();
  });

  it('never slides past the 30-day absolute cap', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { token, session } = service.createSession('127.0.0.1');
    const req = requestWithCookie(cookieFor(service, token));

    for (let day = 0; day < 29; day += 1) {
      time.advance(DAY_MS);
      service.touch(session, '127.0.0.1');
    }
    expect(session.expiresAt).toBe(session.createdAt + 30 * DAY_MS);
    time.advance(DAY_MS);
    expect(service.findSession(req)).toBeNull();
  });

  it('finds no session in mode none', () => {
    const config = jukeboxConfig({ mode: 'none' });
    const service = new AuthService(config);

    expect(service.findSession(requestWithCookie('ndmcp-web-8808=a.b'))).toBeNull();
  });

  it('compares the CSRF token with the session token only', () => {
    const service = new AuthService(jukeboxConfig());
    const { session } = service.createSession('127.0.0.1');

    expect(service.isCsrfTokenValid(session, session.csrfToken)).toBe(true);
    expect(service.isCsrfTokenValid(session, 'wrong')).toBe(false);
    expect(service.isCsrfTokenValid(session, undefined)).toBe(false);
    expect(service.isCsrfTokenValid(session, [session.csrfToken])).toBe(false);
  });
});

describe('AuthService credential', () => {
  it('ends every admin session and closes its streams when the stored password changes', () => {
    let stored: string | null = adminHash;
    const service = new AuthService(jukeboxConfig(), { readSavedAdminHash: () => stored });
    const { token, session } = service.createSession('127.0.0.1');
    const stream = new FakeStream();
    service.trackStream(session.id, stream as unknown as ServerResponse, '127.0.0.1');

    service.sweep();
    expect(stream.destroyed).toBe(false);
    stored = otherHash;
    service.sweep();

    expect(stream.destroyed).toBe(true);
    expect(service.findSession(requestWithCookie(cookieFor(service, token)))).toBeNull();
    expect(readAuthFile(PORT).sessions).toEqual([]);
  });

  it('reads the store again only after it changes, so a malformed store warns once', () => {
    const settingsPath = join(dir, 'settings.json');
    writeFileSync(settingsPath, '{ not json');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const service = new AuthService(jukeboxConfig());
    const { token } = service.createSession('127.0.0.1');

    service.sweep();
    service.sweep();
    const malformedWarnings = warn.mock.calls.filter(([message]) => String(message).includes('not valid JSON'));
    writeFileSync(settingsPath, JSON.stringify({ webui: { auth: { mode: 'jukebox', adminPasswordHash: otherHash } } }));
    service.sweep();

    expect(malformedWarnings).toHaveLength(1);
    expect(service.findSession(requestWithCookie(cookieFor(service, token)))).toBeNull();
  });

  it('keeps the credential when the store is unreadable', () => {
    const service = new AuthService(jukeboxConfig(), { readSavedAdminHash: () => undefined });
    const { token } = service.createSession('127.0.0.1');

    service.sweep();

    expect(service.findSession(requestWithCookie(cookieFor(service, token)))).not.toBeNull();
  });

  it('treats a hash that is not Argon2id as unset, so the login stays off', async () => {
    const service = new AuthService(jukeboxConfig({ adminPasswordHash: 'plaintext-by-mistake' }));

    expect(service.hasAdminPassword()).toBe(false);
    expect(await service.verifyAdminPassword('plaintext-by-mistake')).toBe(false);
    expect(() => service.createSession('127.0.0.1')).toThrow(/No admin password/);
  });

  it('verifies the admin password against the stored hash', async () => {
    const service = new AuthService(jukeboxConfig());

    expect(await service.verifyAdminPassword(PASSWORD)).toBe(true);
    expect(await service.verifyAdminPassword('wrong password!')).toBe(false);
  });

  it('logs in with the admin password and refuses a wrong one', async () => {
    const service = new AuthService(jukeboxConfig());

    const login = await service.login(PASSWORD, '127.0.0.1');

    expect(login).not.toBeNull();
    expect(service.findSession(requestWithCookie(cookieFor(service, login?.token ?? '')))?.id).toBe(login?.session.id);
    expect(await service.login('wrong password!', '127.0.0.1')).toBeNull();
  });

  it('starts no session when the password changes while the old one is being verified', async () => {
    let stored: string | null = adminHash;
    const service = new AuthService(jukeboxConfig(), { readSavedAdminHash: () => stored });

    const pending = service.login(PASSWORD, '127.0.0.1');
    stored = otherHash;
    service.sweep();

    expect(await pending).toBeNull();
    expect(readAuthFile(PORT).sessions).toEqual([]);
  });
});

describe('AuthService streams', () => {
  it('closes a session stream on logout and on expiry, and forgets a closed stream', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const first = service.createSession('127.0.0.1').session;
    const second = service.createSession('127.0.0.1').session;
    const loggedOut = new FakeStream();
    const expiring = new FakeStream();
    const closedEarly = new FakeStream();
    service.trackStream(first.id, loggedOut as unknown as ServerResponse, '127.0.0.1');
    service.trackStream(second.id, expiring as unknown as ServerResponse, '127.0.0.1');
    service.trackStream(second.id, closedEarly as unknown as ServerResponse, '127.0.0.1');
    closedEarly.emit('close');

    service.deleteSession(first.id);
    expect(loggedOut.destroyed).toBe(true);
    expect(expiring.destroyed).toBe(false);

    time.advance(8 * DAY_MS);
    service.sweep();
    expect(expiring.destroyed).toBe(true);
    expect(closedEarly.destroyed).toBe(false);
  });

  it("ends only the host's guest page stream when the jukebox closes or expires, with the same reason", () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const admin = service.createSession('127.0.0.1').session;
    service.createJukeboxCode(1, false);
    const closedPage = new FakeStream();
    const player = new FakeStream();
    service.trackStream(admin.id, closedPage as unknown as ServerResponse, '127.0.0.1', true);
    service.trackStream(admin.id, player as unknown as ServerResponse, '127.0.0.1');

    service.revokeJukeboxCode();
    service.createJukeboxCode(1, false);
    const expiredPage = new FakeStream();
    service.trackStream(admin.id, expiredPage as unknown as ServerResponse, '127.0.0.1', true);
    time.advance(60 * 60 * 1000);
    service.sweep();

    expect(closedPage.written).toEqual([endedFrame('closed')]);
    expect(expiredPage.written).toEqual([endedFrame('expired')]);
    expect([player.written, player.destroyed]).toEqual([[], false]);
  });
});

describe('AuthService persistence', () => {
  it('writes the store beside settings.json with mode 0600 and keeps only the secret digest', () => {
    const service = new AuthService(jukeboxConfig());
    const { session } = service.createSession('192.168.1.5');

    expect(getAuthStorePath(PORT)).toBe(join(dir, `webui-auth-${String(PORT)}.json`));
    const file = JSON.parse(readFileSync(getAuthStorePath(PORT), 'utf8')) as { version: number; sessions: SessionRecord[] };
    expect(file.version).toBe(1);
    expect(file.sessions).toEqual([session]);
    expect(Object.keys(session).sort()).toEqual(
      ['createdAt', 'credentialEpoch', 'csrfToken', 'expiresAt', 'hostNickname', 'id', 'lastAddress', 'lastSeenAt', 'role', 'secretDigest'],
    );
    expect(session.credentialEpoch).toMatch(/^[0-9a-f]{16}$/);
    if (process.platform !== 'win32') expect(statSync(getAuthStorePath(PORT)).mode & 0o777).toBe(0o600);
  });

  it('keeps a separate store per port, so two players on one config directory keep their own sessions', async () => {
    const base = jukeboxConfig();
    const otherPortConfig = makeTestConfig({ webui: { ...base.webui, port: PORT + 1 } });
    const first = new AuthService(base);
    const second = new AuthService(otherPortConfig);
    const firstLogin = first.createSession('127.0.0.1');
    const secondLogin = second.createSession('127.0.0.1');

    const restarted = await AuthService.load(base, 'store', null);
    restarted.claimStore();

    expect(restarted.findSession(requestWithCookie(cookieFor(restarted, firstLogin.token)))?.id).toBe(firstLogin.session.id);
    expect(readAuthFile(PORT).sessions.map((session) => session.id)).toEqual([firstLogin.session.id]);
    expect(readAuthFile(PORT + 1).sessions.map((session) => session.id)).toEqual([secondLogin.session.id]);
  });

  it('writes a lastSeenAt change at most every 5 minutes, and at flush', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { session } = service.createSession('127.0.0.1');
    const storedLastSeen = (): number | undefined => readAuthFile(PORT).sessions[0]?.lastSeenAt;

    time.advance(60_000);
    service.touch(session, '127.0.0.1');
    expect(storedLastSeen()).toBe(session.createdAt);
    time.advance(4 * 60_000);
    service.touch(session, '127.0.0.1');
    expect(storedLastSeen()).toBe(session.lastSeenAt);

    time.advance(60_000);
    service.touch(session, '127.0.0.1');
    service.flush();
    expect(storedLastSeen()).toBe(session.lastSeenAt);
  });

  it('adopts live sessions and drops expired and other-epoch ones when it claims the store', async () => {
    const config = jukeboxConfig();
    const writer = new AuthService(config);
    const live = writer.createSession('127.0.0.1');
    const file = readAuthFile(PORT);
    const expired = { ...live.session, id: 'expired', expiresAt: Date.now() - 1 };
    const otherEpoch = { ...live.session, id: 'other', credentialEpoch: '0000000000000000' };
    writeAuthFile(PORT, { ...file, sessions: [...file.sessions, expired, otherEpoch] });

    const loaded = await AuthService.load(config, 'store', null);

    expect(loaded.findSession(requestWithCookie(cookieFor(loaded, live.token)))).toBeNull();
    expect(readAuthFile(PORT).sessions).toHaveLength(3);
    loaded.claimStore();
    expect(loaded.findSession(requestWithCookie(cookieFor(loaded, live.token)))?.id).toBe(live.session.id);
    expect(readAuthFile(PORT).sessions.map((session) => session.id)).toEqual([live.session.id]);
  });

  it('reads the sessions the previous owner left between load and the claim', async () => {
    const config = jukeboxConfig();
    const previousOwner = new AuthService(config);
    const loggedOut = previousOwner.createSession('127.0.0.1');
    const loaded = await AuthService.load(config, 'store', null);
    previousOwner.deleteSession(loggedOut.session.id);
    const minted = previousOwner.createSession('127.0.0.1');

    loaded.claimStore();

    expect(loaded.findSession(requestWithCookie(cookieFor(loaded, loggedOut.token)))).toBeNull();
    expect(readAuthFile(PORT).sessions.map((session) => session.id)).toEqual([minted.session.id]);
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['a schema violation', JSON.stringify({ version: 2, sessions: [] })],
  ])('starts empty and warns on %s', async (_label, content) => {
    writeFileSync(join(dir, `webui-auth-${String(PORT)}.json`), content);

    const loaded = await AuthService.load(jukeboxConfig(), 'store', null);

    expect(loaded.findSession(requestWithCookie('ndmcp-web-8808=a.b'))).toBeNull();
    expect(readAuthFile(PORT)).toEqual({ version: 1, sessions: [], envAdminHash: null, jukeboxCode: null, bans: [] });
  });

  it('creates no store in mode none', async () => {
    const service = await AuthService.load(jukeboxConfig({ mode: 'none' }), 'store', null);
    service.claimStore();
    service.flush();

    expect(() => statSync(join(dir, `webui-auth-${String(PORT)}.json`))).toThrow();
  });
});

describe('AuthService env password', () => {
  const envConfig = (): Config => jukeboxConfig({ adminPasswordHash: null });

  it('hashes WEBUI_ADMIN_PASSWORD and keeps the hash as envAdminHash', async () => {
    const service = await AuthService.load(envConfig(), 'env', PASSWORD);
    service.claimStore();

    const stored = readAuthFile(PORT).envAdminHash;
    expect(stored).not.toBeNull();
    expect(await verifyPassword(PASSWORD, stored ?? '')).toBe(true);
    expect(await service.verifyAdminPassword(PASSWORD)).toBe(true);
  });

  it('reuses the stored hash while the variable matches it, so admin sessions survive a restart', async () => {
    const first = await AuthService.load(envConfig(), 'env', PASSWORD);
    first.claimStore();
    const { token } = first.createSession('127.0.0.1');
    const storedHash = readAuthFile(PORT).envAdminHash;

    const restarted = await AuthService.load(envConfig(), 'env', PASSWORD);
    restarted.claimStore();

    expect(readAuthFile(PORT).envAdminHash).toBe(storedHash);
    expect(restarted.findSession(requestWithCookie(cookieFor(restarted, token)))).not.toBeNull();
  });

  it('rehashes a changed variable, which ends the admin sessions', async () => {
    const first = await AuthService.load(envConfig(), 'env', PASSWORD);
    first.claimStore();
    const { token } = first.createSession('127.0.0.1');

    const restarted = await AuthService.load(envConfig(), 'env', 'a different password');

    expect(restarted.findSession(requestWithCookie(cookieFor(restarted, token)))).toBeNull();
    expect(await restarted.verifyAdminPassword('a different password')).toBe(true);
  });

  it('turns the login off when the variable is unset', async () => {
    const service = await AuthService.load(envConfig(), 'env', null);

    expect(service.hasAdminPassword()).toBe(false);
  });

  it('refuses a variable outside 12 to 128 characters', async () => {
    await expect(AuthService.load(envConfig(), 'env', 'short')).rejects.toThrow(/12 to 128 characters/);
  });

  it('ignores envAdminHash when the player runs from the store', async () => {
    writeAuthFile(PORT, { version: 1, sessions: [], envAdminHash: otherHash });

    const service = await AuthService.load(jukeboxConfig(), 'store', null);
    service.claimStore();

    expect(await service.verifyAdminPassword(PASSWORD)).toBe(true);
    expect(readAuthFile(PORT).envAdminHash).toBe(otherHash);
  });
});

describe('AuthService jukebox code and guest sessions', () => {
  const HOUR_MS = 60 * 60 * 1000;

  function joinGuest(service: AuthService, key: string, nickname: string | null = null): { token: string; label: string; id: string } {
    const result = service.join(key, nickname, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES);
    if (result.kind !== 'joined') throw new Error(`join failed: ${result.kind}`);
    return { token: result.token, label: result.session.label, id: result.session.id };
  }

  it('stores the key beside its digest and reports the status without the key', () => {
    const service = new AuthService(jukeboxConfig());
    const { key, jukeboxCode } = service.createJukeboxCode(24, false);

    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(readAuthFile(PORT).jukeboxCode).toMatchObject({ secret: key, digest: jukeboxCode.digest });
    expect(jukeboxCode.digest).not.toBe(key);
    expect(service.jukeboxShare()).toMatchObject({ active: true, expiresAt: jukeboxCode.expiresAt, key });
    expect(JSON.stringify(service.jukeboxStatus())).not.toContain(key);
    expect(service.jukeboxStatus()).toMatchObject({ active: true, expiresAt: jukeboxCode.expiresAt, guestCount: 0 });
  });

  it('redacts the stored key and its digest from a logged store object', () => {
    const service = new AuthService(jukeboxConfig());
    const { key } = service.createJukeboxCode(24, false);

    const logged = JSON.stringify(redact(readAuthFile(PORT)));

    expect(logged).not.toContain(key);
    expect(logged).toContain('"secret":"<REDACTED>"');
    expect(logged).toContain('"digest":"<REDACTED>"');
  });

  it('reads the key again after a restart, and none once the code expired or was revoked', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { key } = service.createJukeboxCode(1, false);

    const restarted = new AuthService(jukeboxConfig(), { now: time.now });
    restarted.claimStore();
    expect(restarted.jukeboxShare().key).toBe(key);

    time.advance(HOUR_MS);
    expect(restarted.jukeboxShare()).toEqual({ active: false, createdAt: null, expiresAt: null, guestCount: 0, key: null });
    restarted.createJukeboxCode(1, false);
    restarted.revokeJukeboxCode();
    expect(restarted.jukeboxShare().key).toBeNull();
  });

  it('mints a numbered guest session for the right key and refuses a wrong one', () => {
    const service = new AuthService(jukeboxConfig());
    const { key } = service.createJukeboxCode(24, false);

    const first = joinGuest(service, key);
    const second = joinGuest(service, key, 'Ana');

    expect(service.join('not-the-key', null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'invalid' });
    expect([first.label, second.label]).toEqual(['Guest 1', 'Guest 2']);
    expect(service.findSession(requestWithCookie(cookieFor(service, second.token)))).toMatchObject({ role: 'guest', nickname: 'Ana' });
    expect(service.jukeboxStatus().guestCount).toBe(2);
  });

  it('refuses every join while no key is active', () => {
    const service = new AuthService(jukeboxConfig());

    expect(service.join('', null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'invalid' });
    expect(service.jukeboxStatus()).toEqual({ active: false, createdAt: null, expiresAt: null, guestCount: 0 });
  });

  it('matches only the live key, so a rotated, expired or revoked key fails the admin check', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    expect(service.isLiveJukeboxCode('')).toBe(false);

    const first = service.createJukeboxCode(1, false);
    expect(service.isLiveJukeboxCode(first.key)).toBe(true);
    expect(service.isLiveJukeboxCode('not-the-key')).toBe(false);

    const rotated = service.createJukeboxCode(1, false);
    expect(service.isLiveJukeboxCode(first.key)).toBe(false);
    expect(service.isLiveJukeboxCode(rotated.key)).toBe(true);

    time.advance(HOUR_MS);
    expect(service.isLiveJukeboxCode(rotated.key)).toBe(false);

    const fresh = service.createJukeboxCode(1, false);
    service.revokeJukeboxCode();
    expect(service.isLiveJukeboxCode(fresh.key)).toBe(false);
  });

  it('keeps the session and the stored nickname of a guest that joins again with another nickname', () => {
    const service = new AuthService(jukeboxConfig());
    const { key } = service.createJukeboxCode(24, false);
    const { token } = joinGuest(service, key, 'Ana');
    const current = service.findSession(requestWithCookie(cookieFor(service, token)));
    if (current?.role !== 'guest') throw new Error('no guest session');

    const again = service.join(key, 'Bo', '192.168.1.50', current, newDeviceId(), NO_QUEUED_NAMES);
    service.flush();

    expect(again).toMatchObject({ kind: 'kept', session: { id: current.id, nickname: 'Ana', label: 'Guest 1' } });
    expect(readAuthFile(PORT).sessions).toEqual([expect.objectContaining({ nickname: 'Ana' })]);
    expect(service.jukeboxStatus().guestCount).toBe(1);
  });

  it('batches the store write of a guest nickname change', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { key } = service.createJukeboxCode(24, false);
    const { token } = joinGuest(service, key);
    const current = service.findSession(requestWithCookie(cookieFor(service, token)));
    if (current?.role !== 'guest') throw new Error('no guest session');
    const storedNickname = (): string | null | undefined => {
      const stored = readAuthFile(PORT).sessions[0];
      return stored?.role === 'guest' ? stored.nickname : undefined;
    };

    for (let i = 0; i < 4; i++) service.setJukeboxNickname(current, i % 2 === 0 ? 'Bo' : 'Cy');
    expect(storedNickname()).toBeNull();

    time.advance(5 * 60_000);
    service.setJukeboxNickname(current, 'Di');
    expect(storedNickname()).toBe('Di');
  });

  it('refuses the guest past 100 for one key', () => {
    const service = new AuthService(jukeboxConfig());
    const { key } = service.createJukeboxCode(24, false);
    for (let i = 0; i < 100; i++) joinGuest(service, key);

    expect(service.join(key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'full' });
  });

  it('slides a guest idle expiry by a day, never past the key expiry', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { key, jukeboxCode } = service.createJukeboxCode(30, false);
    const { token } = joinGuest(service, key);
    const session = service.findSession(requestWithCookie(cookieFor(service, token)));
    if (session === null) throw new Error('no session');
    expect(session.expiresAt).toBe(time.now() + 24 * HOUR_MS);

    time.advance(20 * HOUR_MS);
    service.touch(session, '192.168.1.50');

    expect(session.expiresAt).toBe(jukeboxCode.expiresAt);
  });

  it('ends a guest session that stays idle for a day', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { key } = service.createJukeboxCode(72, false);
    const { token } = joinGuest(service, key);

    time.advance(24 * HOUR_MS);

    expect(service.findSession(requestWithCookie(cookieFor(service, token)))).toBeNull();
  });

  it('gives the guest cookie the longest key lifetime, whatever the current key has left', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    service.createJukeboxCode(2, false);
    time.advance(HOUR_MS);

    expect(service.guestSessionCookie('id.secret')).toBe(`ndmcp-web-8808=id.secret; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(90 * DAY_MS / 1000)}`);
  });

  it('keeps an idle guest past the old key expiry after a rotation to a longer key', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const first = service.createJukeboxCode(1, false);
    const kept = joinGuest(service, first.key);
    time.advance(50 * 60 * 1000);
    service.createJukeboxCode(24, false);
    time.advance(20 * 60 * 1000);
    service.sweep();

    const session = service.findSession(requestWithCookie(cookieFor(service, kept.token)));
    expect(session?.expiresAt).toBe(Date.UTC(2026, 0, 1) + 24 * HOUR_MS);
  });

  it('caps a kept guest at the new key expiry after a rotation to a shorter key', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const first = service.createJukeboxCode(48, false);
    const kept = joinGuest(service, first.key);
    service.createJukeboxCode(2, false);

    const session = service.findSession(requestWithCookie(cookieFor(service, kept.token)));
    expect(session?.expiresAt).toBe(Date.UTC(2026, 0, 1) + 2 * HOUR_MS);
  });

  it('keeps the guests on a rotation unless asked to sign them out, and the old key stops working', () => {
    const service = new AuthService(jukeboxConfig());
    const first = service.createJukeboxCode(24, false);
    const kept = joinGuest(service, first.key);

    const rotated = service.createJukeboxCode(48, false);
    const later = joinGuest(service, rotated.key);

    expect(rotated.rotated).toBe(true);
    expect(service.join(first.key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'invalid' });
    expect(service.findSession(requestWithCookie(cookieFor(service, kept.token)))).not.toBeNull();
    expect(later.label).toBe('Guest 2');

    const stream = new FakeStream();
    service.trackStream(kept.id, stream as unknown as ServerResponse, '192.168.1.50');
    const fresh = service.createJukeboxCode(24, true);

    expect(service.findSession(requestWithCookie(cookieFor(service, kept.token)))).toBeNull();
    expect(stream.written).toEqual([endedFrame('new-code')]);
    expect(service.jukeboxStatus().guestCount).toBe(0);
    expect(joinGuest(service, fresh.key).label).toBe('Guest 1');
  });

  it('removes a key past its expiry that the sweep has not reached, and reports no revocation', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    service.createJukeboxCode(1, false);
    time.advance(2 * 60 * 60 * 1000);

    expect(service.revokeJukeboxCode()).toBe(false);
    expect(readAuthFile(PORT).jukeboxCode).toBeNull();
  });

  it('revokes the key, signs every guest out and leaves admin sessions alone', () => {
    const service = new AuthService(jukeboxConfig());
    const admin = service.createSession('127.0.0.1');
    const { key } = service.createJukeboxCode(24, false);
    const guest = joinGuest(service, key);

    expect(service.revokeJukeboxCode()).toBe(true);
    expect(service.revokeJukeboxCode()).toBe(false);
    expect(service.findSession(requestWithCookie(cookieFor(service, guest.token)))).toBeNull();
    expect(service.findSession(requestWithCookie(cookieFor(service, admin.token)))).not.toBeNull();
    expect(readAuthFile(PORT).jukeboxCode).toBeNull();
  });

  it('sweeps an expired key, closes its guest streams and logs it', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now, readSavedAdminHash: () => adminHash });
    const { key } = service.createJukeboxCode(1, false);
    const guest = joinGuest(service, key);
    const stream = new FakeStream();
    service.trackStream(guest.id, stream as unknown as ServerResponse, '192.168.1.50');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    time.advance(HOUR_MS);
    service.sweep();

    expect(stream.written).toEqual([endedFrame('expired')]);
    expect(service.hasJukeboxCode()).toBe(false);
    expect(readAuthFile(PORT)).toMatchObject({ jukeboxCode: null, sessions: [] });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('jukebox code expired'));
  });

  it('reloads a live key with its guests and drops an expired key with its guests', () => {
    const time = clock();
    const writer = new AuthService(jukeboxConfig(), { now: time.now });
    const { key } = writer.createJukeboxCode(2, false);
    const guest = joinGuest(writer, key);

    const reader = new AuthService(jukeboxConfig(), { now: time.now });
    reader.claimStore();
    expect(reader.findSession(requestWithCookie(cookieFor(reader, guest.token)))).toMatchObject({ role: 'guest' });

    time.advance(2 * HOUR_MS);
    const late = new AuthService(jukeboxConfig(), { now: time.now });
    late.claimStore();
    expect(late.hasJukeboxCode()).toBe(false);
    expect(readAuthFile(PORT)).toMatchObject({ jukeboxCode: null, sessions: [] });
  });

  it('reads a store written before jukebox codes existed as having no key', () => {
    writeAuthFile(PORT, { version: 1, sessions: [], envAdminHash: null });

    expect(readAuthFile(PORT).jukeboxCode).toBeNull();
  });

  it('reports the guest jukebox view, and the host label for an admin session', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const admin = service.createSession('127.0.0.1');
    const adminAt = time.now();
    time.advance(60_000);
    const { key, jukeboxCode } = service.createJukeboxCode(24, false);
    const guest = joinGuest(service, key, 'Cy');
    const guestAt = time.now();

    expect(service.guestJukeboxFor(guest.id)).toEqual({ label: 'Guest 1', nickname: 'Cy', expiresAt: jukeboxCode.expiresAt, joinedAt: guestAt });
    expect(service.guestJukeboxFor(admin.session.id)).toEqual({ label: 'Host', nickname: null, expiresAt: jukeboxCode.expiresAt, joinedAt: adminAt });

    time.advance(60_000);
    const rotated = service.createJukeboxCode(48, false);
    expect(service.guestJukeboxFor(guest.id)).toEqual({ label: 'Guest 1', nickname: 'Cy', expiresAt: rotated.jukeboxCode.expiresAt, joinedAt: guestAt });
    expect(service.guestJukeboxFor('gone')).toBeNull();
  });

  it('gives an admin session the host view only while a code is live, under a host nickname a restart keeps', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const admin = service.createSession('127.0.0.1').session;

    expect(admin.hostNickname).toBeNull();
    expect(service.guestJukeboxFor(admin.id)).toBeNull();
    expect(service.isLiveJukeboxSession(admin.id)).toBe(false);

    service.createJukeboxCode(24, false);
    service.setJukeboxNickname(admin, 'DJ Bo');
    service.flush();
    const restarted = new AuthService(jukeboxConfig(), { now: time.now });
    restarted.claimStore();

    expect(service.isLiveJukeboxSession(admin.id)).toBe(true);
    expect(restarted.guestJukeboxFor(admin.id)).toMatchObject({ label: 'Host', nickname: 'DJ Bo' });
    service.revokeJukeboxCode();
    expect(service.guestJukeboxFor(admin.id)).toBeNull();
    expect(service.isLiveJukeboxSession(admin.id)).toBe(false);
  });

  it('keeps the host view through an expiry until the sweep, so the sweep ends the host stream with its reason', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const admin = service.createSession('127.0.0.1').session;
    service.createJukeboxCode(1, false);

    time.advance(60 * 60 * 1000 + 1);

    expect(service.isLiveJukeboxSession(admin.id)).toBe(false);
    expect(service.guestJukeboxFor(admin.id)).toMatchObject({ label: 'Host' });
    service.sweep();
    expect(service.guestJukeboxFor(admin.id)).toBeNull();
  });

  it('keeps the host identity through a new code that signs every guest out', () => {
    const service = new AuthService(jukeboxConfig());
    const admin = service.createSession('127.0.0.1').session;
    const { key } = service.createJukeboxCode(24, false);
    const guest = joinGuest(service, key);
    service.setJukeboxNickname(admin, 'DJ Bo');

    service.createJukeboxCode(24, true);

    expect(service.isLiveJukeboxSession(guest.id)).toBe(false);
    expect(service.isLiveJukeboxSession(admin.id)).toBe(true);
    expect(service.guestJukeboxFor(admin.id)?.nickname).toBe('DJ Bo');
    expect(service.listGuests()).toEqual([]);
  });

  it('reads an admin session stored before host nicknames existed as having none', () => {
    const service = new AuthService(jukeboxConfig());
    const legacy: Partial<AdminSession> = { ...service.createSession('127.0.0.1').session };
    delete legacy.hostNickname;
    writeAuthFile(PORT, { version: 1, sessions: [legacy as AdminSession], envAdminHash: null });

    expect(readAuthFile(PORT).sessions[0]).toMatchObject({ role: 'admin', hostNickname: null });
  });

  it('allows 10 joins an hour from an internet network and 60 from a LAN one', () => {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    for (let i = 0; i < 10; i++) expect(service.takeJoinToken('203.0.113.5', true)).toBe(0);
    for (let i = 0; i < 60; i++) expect(service.takeJoinToken('192.168.1.50', false)).toBe(0);

    expect(service.takeJoinToken('203.0.113.5', true)).toBe(6 * 60 * 1000);
    expect(service.takeJoinToken('192.168.1.50', false)).toBe(60 * 1000);
    time.advance(6 * 60 * 1000);
    expect(service.takeJoinToken('203.0.113.5', true)).toBe(0);
  });
});

describe('AuthService guest management and bans', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const HOST = '127.0.0.1';

  function joinFrom(service: AuthService, key: string, address: string, nickname: string | null = null): string {
    const result = service.join(key, nickname, address, null, newDeviceId(), NO_QUEUED_NAMES);
    if (result.kind !== 'joined') throw new Error(`join failed: ${result.kind}`);
    return result.session.id;
  }

  function jukeboxAt(time = clock()): { service: AuthService; key: string; time: ReturnType<typeof clock> } {
    const service = new AuthService(jukeboxConfig(), { now: time.now });
    const { key } = service.createJukeboxCode(24, false);
    return { service, key, time };
  }

  it('lists the live guests, online while a stream is open or a request came in the last 2 minutes', () => {
    const { service, key, time } = jukeboxAt();
    const streaming = joinFrom(service, key, '192.168.1.50');
    const idle = joinFrom(service, key, '192.168.1.51');
    service.trackStream(streaming, new FakeStream() as unknown as ServerResponse, '192.168.1.50');

    expect(service.listGuests().map(({ session, online }) => [session.id, online])).toEqual([[streaming, true], [idle, true]]);
    time.advance(2 * 60 * 1000);
    expect(service.listGuests().map(({ session, online }) => [session.id, online])).toEqual([[streaming, true], [idle, false]]);
  });

  function streamOf(service: AuthService, sessionId: string): FakeStream {
    const stream = new FakeStream();
    service.trackStream(sessionId, stream as unknown as ServerResponse, '192.168.1.50');
    return stream;
  }

  it('ends a guest stream with the closed reason when the host closes the jukebox, and leaves it open to flush', () => {
    const { service, key } = jukeboxAt();
    const stream = streamOf(service, joinFrom(service, key, '192.168.1.50'));

    service.revokeJukeboxCode();

    expect(stream.written).toEqual([endedFrame('closed')]);
    expect({ ended: stream.writableEnded, destroyed: stream.destroyed }).toEqual({ ended: true, destroyed: false });
  });

  // A 48-hour code outlives the guest's one-day idle expiry, so only the idle expiry ends the guest.
  function longJukebox(): { service: AuthService; key: string; time: ReturnType<typeof clock> } {
    const time = clock();
    const service = new AuthService(jukeboxConfig(), { now: time.now, readSavedAdminHash: () => adminHash });
    const { key } = service.createJukeboxCode(48, false);
    return { service, key, time };
  }

  it('ends a guest stream with the idle reason when its idle expiry passes under a live code', () => {
    const { service, key, time } = longJukebox();
    const stream = streamOf(service, joinFrom(service, key, '192.168.1.50'));

    time.advance(DAY_MS);
    service.sweep();

    expect(service.hasJukeboxCode()).toBe(true);
    expect(stream.written).toEqual([endedFrame('idle')]);
  });

  it('ends a guest stream with the expired reason when its idle expiry passes under a code that also expired', () => {
    const { service, key, time } = longJukebox();
    const stream = streamOf(service, joinFrom(service, key, '192.168.1.50'));

    time.advance(2 * DAY_MS);
    service.sweep();

    expect(service.hasJukeboxCode()).toBe(false);
    expect(stream.written).toEqual([endedFrame('expired')]);
  });

  it('names an unswept guest under a code that expired as expired when the host makes a new code', () => {
    const { service, key, time } = longJukebox();
    const stream = streamOf(service, joinFrom(service, key, '192.168.1.50'));
    time.advance(2 * DAY_MS);

    service.createJukeboxCode(24, false);

    expect(stream.written).toEqual([endedFrame('expired')]);
  });

  it('names a guest the sweep has not reached yet by the new code when the host makes a new code that signs guests out', () => {
    const { service, key, time } = longJukebox();
    const idle = streamOf(service, joinFrom(service, key, '192.168.1.50'));
    time.advance(DAY_MS);
    const active = streamOf(service, joinFrom(service, key, '192.168.1.51'));

    service.createJukeboxCode(24, true);

    expect([idle.written, active.written]).toEqual([[endedFrame('new-code')], [endedFrame('new-code')]]);
  });

  it('names a guest the sweep has not reached yet as closed when the host closes the jukebox', () => {
    const { service, key, time } = longJukebox();
    const idle = streamOf(service, joinFrom(service, key, '192.168.1.50'));
    time.advance(DAY_MS);
    const active = streamOf(service, joinFrom(service, key, '192.168.1.51'));

    service.revokeJukeboxCode();

    expect([idle.written, active.written]).toEqual([[endedFrame('closed')], [endedFrame('closed')]]);
  });

  it('names a guest as expired when the host closes a jukebox whose code expired before the sweep', () => {
    const { service, key, time } = longJukebox();
    const stream = streamOf(service, joinFrom(service, key, '192.168.1.50'));
    time.advance(2 * DAY_MS);

    service.revokeJukeboxCode();

    expect(stream.written).toEqual([endedFrame('expired')]);
  });

  it('destroys the streams with no reason on a guest logout and on an admin session end', () => {
    const { service, key } = jukeboxAt();
    const guest = streamOf(service, joinFrom(service, key, '192.168.1.50'));
    const admin = service.createSession(HOST).session;
    const adminStream = streamOf(service, admin.id);

    service.deleteSession([...service.listGuests()][0]?.session.id ?? '');
    service.deleteSession(admin.id);

    expect([guest.written, guest.destroyed, adminStream.written, adminStream.destroyed]).toEqual([[], true, [], true]);
  });

  it('leaves a stream that already ended, such as an evicted one, with its first frame', () => {
    const { service, key } = jukeboxAt();
    const id = joinFrom(service, key, '192.168.1.50');
    const stream = streamOf(service, id);
    stream.end('event: evicted\ndata: {}\n\n');

    service.signOutGuest(id);

    expect(stream.written).toEqual(['event: evicted\ndata: {}\n\n']);
  });

  it('signs a guest out and closes its streams, while the jukebox code still admits it', () => {
    const { service, key } = jukeboxAt();
    const id = joinFrom(service, key, '192.168.1.50');
    const stream = new FakeStream();
    service.trackStream(id, stream as unknown as ServerResponse, '192.168.1.50');
    expect(service.isLiveJukeboxSession(id)).toBe(true);

    expect(service.signOutGuest(id)?.id).toBe(id);
    expect(service.isLiveJukeboxSession(id)).toBe(false);
    expect(stream.written).toEqual([endedFrame('removed')]);
    expect(service.listGuests()).toEqual([]);
    expect(readAuthFile(PORT).sessions).toEqual([]);
    expect(service.join(key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES).kind).toBe('joined');
  });

  it('refuses to sign out or ban an admin session or an unknown id', () => {
    const { service } = jukeboxAt();
    const { session } = service.createSession('127.0.0.1');

    expect(service.signOutGuest(session.id)).toBeNull();
    expect(service.signOutGuest('missing')).toBeNull();
    expect(service.banGuest(session.id, 24, HOST)).toEqual({ kind: 'not-found' });
  });

  it('records a guest ban until the key expires and a network ban for the chosen hours, and stores both', () => {
    const { service, key, time } = jukeboxAt();
    const id = joinFrom(service, key, '2001:db8:1:2::7', 'Ana');
    const stream = new FakeStream();
    service.trackStream(id, stream as unknown as ServerResponse, '2001:db8:1:2::7');

    const result = service.banGuest(id, 1, HOST);

    expect(result.kind).toBe('banned');
    expect(stream.written).toEqual([endedFrame('removed')]);
    const start = time.now();
    expect(service.listBans()).toEqual([
      expect.objectContaining({ kind: 'guest', label: 'Guest 1', nickname: 'Ana', networkKey: '2001:db8:1:2::/64', createdAt: start, expiresAt: start + 24 * HOUR_MS }),
      expect.objectContaining({ kind: 'network', label: 'Guest 1', nickname: 'Ana', networkKey: '2001:db8:1:2::/64', expiresAt: start + HOUR_MS }),
    ]);
    expect(readAuthFile(PORT).bans).toEqual(service.listBans());
    expect(service.listGuests()).toEqual([]);
  });

  it('moves a guest ban to a new key that keeps the guests, and keeps a network ban as it was', () => {
    const { service, key, time } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 1, HOST);
    time.advance(HOUR_MS / 2);

    const { jukeboxCode } = service.createJukeboxCode(48, false);

    expect(service.listBans().map((ban) => [ban.kind, ban.expiresAt])).toEqual([
      ['guest', jukeboxCode.expiresAt],
      ['network', jukeboxCode.createdAt + HOUR_MS / 2],
    ]);
    expect(readAuthFile(PORT).bans).toEqual(service.listBans());
  });

  it('moves a guest ban to a new key that signs the guests out', () => {
    const { service, key } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 0, HOST);

    const { jukeboxCode } = service.createJukeboxCode(48, true);

    expect(service.listBans().map((ban) => [ban.kind, ban.expiresAt])).toEqual([['guest', jukeboxCode.expiresAt]]);
    expect(readAuthFile(PORT).bans).toEqual(service.listBans());
  });

  it('drops a guest ban left over from an expired key when the host makes a new one', () => {
    const { service, key, time } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 0, HOST);
    time.advance(24 * HOUR_MS);

    service.createJukeboxCode(24, false);

    expect(service.listBans()).toEqual([]);
    expect(readAuthFile(PORT).bans).toEqual([]);
  });

  it('drops the guest bans when the key is revoked or expires', () => {
    const revoked = jukeboxAt();
    revoked.service.banGuest(joinFrom(revoked.service, revoked.key, '203.0.113.6'), 720, HOST);
    revoked.service.revokeJukeboxCode();
    expect(revoked.service.listBans().map((ban) => ban.kind)).toEqual(['network']);

    const expired = jukeboxAt();
    expired.service.banGuest(joinFrom(expired.service, expired.key, '203.0.113.7'), 720, HOST);
    expired.time.advance(24 * HOUR_MS);
    expired.service.sweep();
    expect(readAuthFile(PORT).bans.map((ban) => ban.kind)).toEqual(['network']);
  });

  it('refuses a banned browser with any key before minting a session, and admits it again once the ban is lifted', () => {
    const { service, key } = jukeboxAt();
    const deviceId = newDeviceId();
    const joined = service.join(key, null, '192.168.1.50', null, deviceId, NO_QUEUED_NAMES);
    if (joined.kind !== 'joined') throw new Error(`join failed: ${joined.kind}`);
    expect(joined.session.deviceId).toBe(deviceId);

    service.banGuest(joined.session.id, 0, HOST);
    const ban = service.listBans()[0];

    expect(ban).toMatchObject({ kind: 'guest', deviceId });
    expect(service.join(key, null, '192.168.1.50', null, deviceId, NO_QUEUED_NAMES)).toEqual({ kind: 'banned' });
    expect(service.join('not-the-key', null, '192.168.1.50', null, deviceId, NO_QUEUED_NAMES)).toEqual({ kind: 'banned' });
    expect(service.jukeboxStatus().guestCount).toBe(0);
    expect(service.join(key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES).kind).toBe('joined');
    service.liftBan(ban?.id ?? '');
    expect(service.join(key, null, '192.168.1.50', null, deviceId, NO_QUEUED_NAMES).kind).toBe('joined');
  });

  it('stores the device id on the guest ban only', () => {
    const { service, key } = jukeboxAt();
    const deviceId = newDeviceId();
    const joined = service.join(key, null, '203.0.113.5', null, deviceId, NO_QUEUED_NAMES);
    if (joined.kind !== 'joined') throw new Error(`join failed: ${joined.kind}`);

    service.banGuest(joined.session.id, 1, HOST);

    expect(readAuthFile(PORT).bans.map((ban) => [ban.kind, ban.deviceId])).toEqual([['guest', deviceId], ['network', null]]);
  });

  it('records only the guest ban when networkBanHours is 0', () => {
    const { service, key } = jukeboxAt();
    const id = joinFrom(service, key, '192.168.1.50');

    service.banGuest(id, 0, HOST);

    expect(service.listBans().map((ban) => ban.kind)).toEqual(['guest']);
    expect(service.isNetworkBanned('192.168.1.50')).toBe(false);
  });

  it('refuses a network ban on a loopback guest and leaves it signed in', () => {
    const { service, key } = jukeboxAt();
    const id = joinFrom(service, key, '127.0.0.1');

    expect(service.banGuest(id, 24, HOST)).toEqual({ kind: 'loopback' });
    expect(service.listGuests()).toHaveLength(1);
    expect(service.listBans()).toEqual([]);
    expect(service.banGuest(id, 0, HOST).kind).toBe('banned');
  });

  it("refuses a network ban on the requester's own network and leaves the guest signed in", () => {
    const { service, key } = jukeboxAt();
    const id = joinFrom(service, key, '2001:db8:1:2::7');

    expect(service.banGuest(id, 24, '2001:db8:1:2::10')).toEqual({ kind: 'own-network' });
    expect(service.banGuest(id, 24, '::ffff:172.17.0.1')).toMatchObject({ kind: 'banned' });
    const proxied = joinFrom(service, key, '172.17.0.1');
    expect(service.banGuest(proxied, 1, '::ffff:172.17.0.1')).toEqual({ kind: 'own-network' });
    expect(service.listGuests().map(({ session }) => session.id)).toEqual([proxied]);
    expect(service.banGuest(proxied, 0, '172.17.0.1').kind).toBe('banned');
  });

  it('closes every open stream on the banned network, admin ones included, tells each guest it was removed, and keeps the sessions', () => {
    const { service, key } = jukeboxAt();
    const banned = joinFrom(service, key, '203.0.113.5');
    const laptop = joinFrom(service, key, '203.0.113.5');
    const elsewhere = joinFrom(service, key, '203.0.113.6');
    const { session: phoneAdmin } = service.createSession('203.0.113.5');
    const streams = { laptop: new FakeStream(), elsewhere: new FakeStream(), phoneAdmin: new FakeStream() };
    service.trackStream(laptop, streams.laptop as unknown as ServerResponse, '203.0.113.5');
    service.trackStream(elsewhere, streams.elsewhere as unknown as ServerResponse, '203.0.113.6');
    service.trackStream(phoneAdmin.id, streams.phoneAdmin as unknown as ServerResponse, '203.0.113.5');

    service.banGuest(banned, 0, HOST);
    expect(streams.laptop.written).toEqual([]);
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 1, HOST);

    expect(streams.laptop.written).toEqual([endedFrame('removed')]);
    expect({ written: streams.phoneAdmin.written, destroyed: streams.phoneAdmin.destroyed }).toEqual({ written: [], destroyed: true });
    expect({ written: streams.elsewhere.written, destroyed: streams.elsewhere.destroyed }).toEqual({ written: [], destroyed: false });
    expect(service.listGuests().map(({ session }) => session.id)).toEqual([laptop, elsewhere]);
  });

  it("matches each stream by the address it opened from, not by its session's last address", () => {
    const { service, key } = jukeboxAt();
    const moved = joinFrom(service, key, '203.0.113.5');
    const arrived = joinFrom(service, key, '198.51.100.9');
    const streams = { moved: new FakeStream(), arrived: new FakeStream() };
    service.trackStream(moved, streams.moved as unknown as ServerResponse, '203.0.113.5');
    service.trackStream(arrived, streams.arrived as unknown as ServerResponse, '198.51.100.9');
    const sessionOf = (id: string): SessionRecord => {
      const found = service.listGuests().find(({ session }) => session.id === id);
      if (found === undefined) throw new Error(`no session ${id}`);
      return found.session;
    };
    service.touch(sessionOf(moved), '198.51.100.9');
    service.touch(sessionOf(arrived), '203.0.113.5');

    service.banGuest(joinFrom(service, key, '203.0.113.5'), 1, HOST);

    expect(streams.moved.written).toEqual([endedFrame('removed')]);
    expect(streams.arrived.written).toEqual([]);
  });

  it('lists the network keys of the live non-loopback admin sessions', () => {
    const { service } = jukeboxAt();
    service.createSession('127.0.0.1');
    service.createSession('2001:db8:1:2::10');
    service.createSession('192.168.1.20');

    expect([...service.adminNetworkKeys()]).toEqual(['2001:db8:1:2::/64', '192.168.1.20']);
  });

  it('blocks a network-banned address and its /64 until the ban expires, and never a loopback source', () => {
    const { service, key, time } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 1, HOST);
    service.banGuest(joinFrom(service, key, '2001:db8:1:2::7'), 24, HOST);

    expect(service.isNetworkBanned('203.0.113.5')).toBe(true);
    expect(service.isNetworkBanned('::ffff:203.0.113.5')).toBe(true);
    expect(service.isNetworkBanned('2001:db8:1:2::99')).toBe(true);
    expect(service.isNetworkBanned('203.0.113.6')).toBe(false);
    expect(service.isNetworkBanned('127.0.0.1')).toBe(false);
    time.advance(HOUR_MS);
    expect(service.isNetworkBanned('203.0.113.5')).toBe(false);
  });

  it('prunes expired bans on the sweep and keeps live ones across a restart', () => {
    const { service, key, time } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 1, HOST);
    service.banGuest(joinFrom(service, key, '203.0.113.9'), 720, HOST);

    time.advance(HOUR_MS);
    service.sweep();

    expect(readAuthFile(PORT).bans.map((ban) => [ban.kind, ban.networkKey])).toEqual([
      ['guest', '203.0.113.5'],
      ['guest', '203.0.113.9'],
      ['network', '203.0.113.9'],
    ]);
    const restarted = new AuthService(jukeboxConfig(), { now: time.now });
    restarted.claimStore();
    expect(restarted.isNetworkBanned('203.0.113.9')).toBe(true);
    expect(restarted.isNetworkBanned('203.0.113.5')).toBe(false);
  });

  it('drops the jukebox code, its guests and the guest bans on a start in mode password, so a later jukebox start revives nothing', () => {
    const { service, key, time } = jukeboxAt();
    const admin = service.createSession(HOST);
    joinFrom(service, key, '203.0.113.5');
    service.banGuest(joinFrom(service, key, '203.0.113.9'), 24, HOST);

    const passwordStart = new AuthService(jukeboxConfig({ mode: 'password' }), { now: time.now });
    passwordStart.claimStore();

    const stored = readAuthFile(PORT);
    expect(stored.jukeboxCode).toBeNull();
    expect(stored.sessions.map((session) => session.id)).toEqual([admin.session.id]);
    expect(stored.bans.map((ban) => ban.kind)).toEqual(['network']);
    expect(passwordStart.isNetworkBanned('203.0.113.9')).toBe(true);
    expect(passwordStart.findSession(requestWithCookie(cookieFor(passwordStart, admin.token)))?.id).toBe(admin.session.id);

    const jukeboxAgain = new AuthService(jukeboxConfig(), { now: time.now });
    jukeboxAgain.claimStore();
    expect(jukeboxAgain.hasJukeboxCode()).toBe(false);
    expect(jukeboxAgain.join(key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'invalid' });
  });

  it('drops the jukebox code, its guests and the guest bans on a start in mode none, and keeps the admin sessions', () => {
    const { service, key, time } = jukeboxAt();
    const admin = service.createSession(HOST);
    joinFrom(service, key, '203.0.113.5');
    service.banGuest(joinFrom(service, key, '203.0.113.9'), 24, HOST);
    writeAuthFile(PORT, { ...readAuthFile(PORT), envAdminHash: 'stored-env-hash' });

    const openStart = new AuthService(jukeboxConfig({ mode: 'none' }), { now: time.now });
    openStart.claimStore();

    const stored = readAuthFile(PORT);
    expect(stored.jukeboxCode).toBeNull();
    expect(stored.sessions.map((session) => session.id)).toEqual([admin.session.id]);
    expect(stored.bans.map((ban) => ban.kind)).toEqual(['network']);
    expect(stored.envAdminHash).toBe('stored-env-hash');

    const jukeboxAgain = new AuthService(jukeboxConfig(), { now: time.now });
    jukeboxAgain.claimStore();
    expect(jukeboxAgain.hasJukeboxCode()).toBe(false);
    expect(jukeboxAgain.join(key, null, '192.168.1.50', null, newDeviceId(), NO_QUEUED_NAMES)).toEqual({ kind: 'invalid' });
    expect(jukeboxAgain.findSession(requestWithCookie(cookieFor(jukeboxAgain, admin.token)))?.id).toBe(admin.session.id);
  });

  it('leaves a store with no jukebox state unwritten on a start in mode none', () => {
    const { service, time } = jukeboxAt();
    service.revokeJukeboxCode();
    service.createSession(HOST);
    // Compact JSON differs from the indented form a write produces, so any write changes the bytes.
    const before = JSON.stringify(readAuthFile(PORT));
    writeFileSync(getAuthStorePath(PORT), before);

    new AuthService(jukeboxConfig({ mode: 'none' }), { now: time.now }).claimStore();

    expect(readFileSync(getAuthStorePath(PORT), 'utf8')).toBe(before);
  });

  it('reads a guest session and a ban stored before device ids existed with a null device id', () => {
    const { service, key, time } = jukeboxAt();
    const guest = joinFrom(service, key, '192.168.1.50');
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 0, HOST);
    const stored = readAuthFile(PORT);
    const withoutDeviceId = <T extends object>(record: T): Partial<T> =>
      Object.fromEntries(Object.entries(record).filter(([field]) => field !== 'deviceId')) as Partial<T>;
    writeFileSync(getAuthStorePath(PORT), JSON.stringify({ ...stored, sessions: stored.sessions.map(withoutDeviceId), bans: stored.bans.map(withoutDeviceId) }));

    const reader = new AuthService(jukeboxConfig(), { now: time.now });
    reader.claimStore();

    expect(reader.listGuests().map(({ session }) => [session.id, session.deviceId])).toEqual([[guest, null]]);
    expect(reader.listBans().map((ban) => [ban.kind, ban.deviceId])).toEqual([['guest', null]]);
  });

  it('reads a stored code without its key as closed, and keeps the admin sessions and network bans', () => {
    const { service, key, time } = jukeboxAt();
    const admin = service.createSession(HOST);
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 24, HOST);
    const guest = joinFrom(service, key, '192.168.1.50');
    const stored = readAuthFile(PORT);
    const keyless = Object.fromEntries(Object.entries(stored.jukeboxCode ?? {}).filter(([field]) => field !== 'secret'));
    writeFileSync(getAuthStorePath(PORT), JSON.stringify({ ...stored, jukeboxCode: keyless }));
    const warn = vi.spyOn(logger, 'warn');

    const reader = new AuthService(jukeboxConfig(), { now: time.now });
    reader.claimStore();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('jukebox starts closed'));
    expect(reader.hasJukeboxCode()).toBe(false);
    expect(reader.findSession(requestWithCookie(cookieFor(reader, admin.token)))).toMatchObject({ id: admin.session.id });
    expect(reader.isLiveJukeboxSession(guest)).toBe(false);
    expect(reader.isNetworkBanned('203.0.113.5')).toBe(true);
    expect(readAuthFile(PORT)).toMatchObject({ jukeboxCode: null, sessions: [expect.objectContaining({ id: admin.session.id })] });
    expect(readAuthFile(PORT).bans.map((ban) => ban.kind)).toEqual(['network']);
  });

  it('clears an unreadable code record once and logs no jukebox warning on starts in modes none and password', () => {
    const { service, time } = jukeboxAt();
    const admin = service.createSession(HOST);
    const stored = readAuthFile(PORT);
    const keyless = Object.fromEntries(Object.entries(stored.jukeboxCode ?? {}).filter(([field]) => field !== 'secret'));
    const keylessFile = JSON.stringify({ ...stored, jukeboxCode: keyless });
    writeFileSync(getAuthStorePath(PORT), keylessFile);
    const warn = vi.spyOn(logger, 'warn');

    expect(readAuthFileWithStatus(PORT)).toMatchObject({ droppedJukeboxCode: true, file: { jukeboxCode: null } });
    new AuthService(jukeboxConfig({ mode: 'none' }), { now: time.now }).claimStore();
    const cleared = readFileSync(getAuthStorePath(PORT), 'utf8');
    new AuthService(jukeboxConfig({ mode: 'none' }), { now: time.now }).claimStore();
    writeFileSync(getAuthStorePath(PORT), keylessFile);
    new AuthService(jukeboxConfig({ mode: 'password' }), { now: time.now }).claimStore();

    expect(JSON.parse(cleared)).toMatchObject({ jukeboxCode: null, sessions: [expect.objectContaining({ id: admin.session.id })] });
    expect(readAuthFileWithStatus(PORT)).toMatchObject({ droppedJukeboxCode: false, file: { jukeboxCode: null } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports no dropped code for a store with no code record', () => {
    writeAuthFile(PORT, { version: 1, sessions: [], envAdminHash: null });

    expect(readAuthFileWithStatus(PORT).droppedJukeboxCode).toBe(false);
  });

  it('reads a store written before bans existed as no bans', () => {
    writeAuthFile(PORT, { version: 1, sessions: [], envAdminHash: null, jukeboxCode: null });

    expect(readAuthFile(PORT).bans).toEqual([]);
  });

  it('lifts a ban and stores the change, and answers null for an unknown id', () => {
    const { service, key } = jukeboxAt();
    service.banGuest(joinFrom(service, key, '203.0.113.5'), 24, HOST);
    const network = service.listBans().find((ban) => ban.kind === 'network');
    if (network === undefined) throw new Error('no network ban');

    expect(service.liftBan(network.id)).toEqual(network);
    expect(service.liftBan(network.id)).toBeNull();
    expect(service.isNetworkBanned('203.0.113.5')).toBe(false);
    expect(readAuthFile(PORT).bans.map((ban) => ban.kind)).toEqual(['guest']);
  });

  it('never reports a ban in mode none', () => {
    const service = new AuthService(jukeboxConfig({ mode: 'none' }));

    expect(service.isNetworkBanned('203.0.113.5')).toBe(false);
  });
});
