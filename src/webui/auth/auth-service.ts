/**
 * Navidrome MCP Server - Web remote sessions and admin credential
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config, ConfigSource } from '../../config.js';
import { readSettings } from '../../config/store.js';
import { getSettingsStorePath } from '../../config/store-path.js';
import {
  ADMIN_PASSWORD_MAX_LENGTH,
  ADMIN_PASSWORD_MIN_LENGTH,
  isAdminPasswordLengthValid,
  JUKEBOX_CODE_MAX_LIFETIME_HOURS,
  type WebuiAdminAccess,
  type WebuiAuthMode,
} from '../../constants/defaults.js';
import { logger } from '../../utils/logger.js';
import { constantTimeEqual, hashPassword, isPasswordHash, randomToken, sha256Hex, verifyPassword } from '../../utils/secrets.js';
import { endSseStream } from '../http-helpers.js';
import { classifySource, networkKey } from '../source-address.js';
import { isTlsEnabled } from '../tls.js';
import {
  readAuthFile,
  readAuthFileWithStatus,
  writeAuthFile,
  type AdminSession,
  type AuthFile,
  type Ban,
  type GuestSession,
  type JukeboxCode,
  type SessionRecord,
} from './auth-store.js';
import { LoginThrottle } from './login-throttle.js';
import { deviceCookieName, readCookieValues, serializeDeviceCookie, serializeSessionCookie, sessionCookieName } from './session-cookie.js';
import { TokenBuckets } from './token-bucket.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** NIST SP 800-63B-4 reauthentication at AAL1: a 7-day idle expiry under a 30-day absolute cap. */
const ADMIN_IDLE_MS = 7 * DAY_MS;
const ADMIN_ABSOLUTE_MS = 30 * DAY_MS;
/** A `lastSeenAt` change alone reaches the file at most this often, so each request avoids a disk write. */
const LAST_SEEN_FLUSH_MS = 5 * 60 * 1000;
const SESSION_ID_BYTES = 16;
const SESSION_SECRET_BYTES = 32;
const CSRF_TOKEN_BYTES = 32;
const CREDENTIAL_EPOCH_HEX_CHARS = 16;
/** A guest session idles out after a day and never outlives its jukebox code. */
const GUEST_IDLE_MS = DAY_MS;
const JUKEBOX_CODE_BYTES = 32;
const JUKEBOX_CODE_ID_BYTES = 16;
export const MAX_GUESTS_PER_CODE = 100;
// An internet source is a stranger more often than a LAN one, so it gets the smaller join budget.
const PUBLIC_JOINS_PER_HOUR = 10;
const LOCAL_JOINS_PER_HOUR = 60;
const NICKNAME_CHANGES_PER_HOUR = 10;
const HOST_JUKEBOX_LABEL = 'Host';
// A phone may close the stream of a page in the background, so a recent request also counts as online.
const GUEST_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const BAN_ID_BYTES = 16;
const DEVICE_ID_BYTES = 16;
// The base64url form of DEVICE_ID_BYTES, so a forged cookie of any other shape never reaches the store.
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// The guest page reads this last event to say why its jukebox ended.
const GUEST_ENDED_EVENT = 'ended';

/**
 * `closed` is the host closing the jukebox, `new-code` a new code made in place of the guests' code,
 * `idle` a guest's idle expiry under a live code, `expired` the code's expiry, `removed` a sign-out or
 * ban of one guest.
 */
type GuestEndReason = 'closed' | 'expired' | 'idle' | 'new-code' | 'removed';

export interface MintedSession<S extends SessionRecord = AdminSession> {
  token: string;
  session: S;
}

interface JukeboxStatus {
  active: boolean;
  createdAt: number | null;
  expiresAt: number | null;
  guestCount: number;
}

interface JukeboxShare extends JukeboxStatus {
  key: string | null;
}

/** The `jukebox` field of the guest stream. `joinedAt` names the session, since a rotation can change `expiresAt`. */
export interface GuestJukebox {
  label: string;
  nickname: string | null;
  expiresAt: number | null;
  joinedAt: number;
}

export interface GuestStatus {
  session: GuestSession;
  online: boolean;
}

type BanResult =
  | { kind: 'banned'; session: GuestSession; bans: Ban[] }
  | { kind: 'not-found' }
  | { kind: 'loopback' }
  | { kind: 'own-network' };

type JoinResult =
  | ({ kind: 'joined' } & MintedSession<GuestSession>)
  | { kind: 'kept'; session: GuestSession }
  | { kind: 'invalid' }
  | { kind: 'full' }
  | { kind: 'banned' };

/** `presented` is false when the request carried no usable device cookie, so `id` is new. */
export interface BrowserDevice {
  id: string;
  presented: boolean;
}

interface AuthServiceOptions {
  source?: ConfigSource;
  envAdminHash?: string | null;
  now?: () => number;
  /** Store mode only. Undefined means the store is unreadable, so the current credential stays. */
  readSavedAdminHash?: () => string | null | undefined;
}

function readStoreAdminHash(): string | null | undefined {
  const settings = readSettings();
  if (settings === null) return undefined;
  const hash = settings.webui?.auth?.adminPasswordHash?.trim() ?? '';
  return hash === '' ? null : hash;
}

function storeStamp(): string | null {
  try {
    const stats = statSync(getSettingsStorePath());
    return `${String(stats.mtimeMs)}:${String(stats.size)}:${String(stats.ino)}`;
  } catch {
    return null;
  }
}

/**
 * The sweep runs on every heartbeat, and a malformed store logs a warning on each read, so the file
 * is read again only after it changes.
 */
function createStoreAdminHashReader(): () => string | null | undefined {
  let lastStamp: string | null = null;
  let lastHash: string | null | undefined;
  return () => {
    const stamp = storeStamp();
    if (stamp === null) {
      lastStamp = null;
      return undefined;
    }
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      lastHash = readStoreAdminHash();
    }
    return lastHash;
  };
}

/** A hand-edited value that is not an Argon2id PHC string would fail every login with no hint, so it reads as unset. */
function usableHash(raw: string | null | undefined, origin: string): string | null {
  const hash = raw?.trim() ?? '';
  if (hash === '') return null;
  if (isPasswordHash(hash)) return hash;
  logger.warn(`webui: ${origin} is not an Argon2id hash, so the admin login stays off until the admin password is set again`);
  return null;
}

/** A password change gives the hash a new epoch, which ends every admin session minted under the old one. */
function credentialEpochOf(hash: string | null): string | null {
  return hash === null ? null : sha256Hex(hash).slice(0, CREDENTIAL_EPOCH_HEX_CHARS);
}

/**
 * Reuses the stored hash while the variable still matches it, so a restart with an unchanged
 * password keeps the credential epoch and every admin session.
 */
async function resolveEnvAdminHash(password: string | null, storedHash: string | null): Promise<string | null> {
  if (password === null) return null;
  if (storedHash !== null && isPasswordHash(storedHash) && await verifyPassword(password, storedHash)) return storedHash;
  if (!isAdminPasswordLengthValid(password)) {
    throw new Error(`WEBUI_ADMIN_PASSWORD must be ${String(ADMIN_PASSWORD_MIN_LENGTH)} to ${String(ADMIN_PASSWORD_MAX_LENGTH)} characters.`);
  }
  return hashPassword(password);
}

/** Only the guest page reads an end reason, so a null reason destroys the stream. */
function closeStream(res: ServerResponse, endReason: GuestEndReason | null): void {
  if (endReason === null) res.destroy();
  else endSseStream(res, GUEST_ENDED_EVENT, { reason: endReason });
}

/**
 * Owns the admin credential, the jukebox code, the session table, the bans and the streams each session
 * holds open. Mode `none` keeps it empty and touches the auth store only to drop the jukebox state.
 */
export class AuthService {
  readonly mode: WebuiAuthMode;
  readonly adminAccess: WebuiAdminAccess;
  readonly throttle: LoginThrottle;
  private readonly source: ConfigSource;
  private readonly port: number;
  private readonly cookieName: string;
  private readonly deviceCookieName: string;
  private readonly secureCookie: boolean;
  private readonly now: () => number;
  private readonly readSavedAdminHash: () => string | null | undefined;
  private readonly sessions = new Map<string, SessionRecord>();
  // Each open stream keeps its own source address, since a network ban closes the streams opened from it.
  private readonly streams = new Map<string, Map<ServerResponse, string | undefined>>();
  private readonly publicJoins: TokenBuckets;
  private readonly localJoins: TokenBuckets;
  private readonly nicknameChanges: TokenBuckets;
  private jukeboxCode: JukeboxCode | null = null;
  private bans: Ban[] = [];
  private readonly envAdminHash: string | null;
  private configuredHash: string | null;
  private adminHash: string | null;
  private credentialEpoch: string | null;
  private dirty = false;
  private lastWriteAt: number;

  constructor(config: Config, options: AuthServiceOptions = {}) {
    const auth = config.webui.auth;
    this.mode = auth.mode;
    this.adminAccess = auth.adminAccess;
    this.source = options.source ?? 'store';
    this.now = options.now ?? Date.now;
    this.throttle = new LoginThrottle(this.now);
    this.publicJoins = new TokenBuckets(PUBLIC_JOINS_PER_HOUR, HOUR_MS, this.now);
    this.localJoins = new TokenBuckets(LOCAL_JOINS_PER_HOUR, HOUR_MS, this.now);
    this.nicknameChanges = new TokenBuckets(NICKNAME_CHANGES_PER_HOUR, HOUR_MS, this.now);
    this.secureCookie = isTlsEnabled(config.webui.tls);
    this.port = config.webui.port;
    this.cookieName = sessionCookieName(this.port, this.secureCookie);
    this.deviceCookieName = deviceCookieName(this.port);
    this.readSavedAdminHash = options.readSavedAdminHash ?? createStoreAdminHashReader();
    this.envAdminHash = options.envAdminHash ?? null;
    this.configuredHash = auth.adminPasswordHash;
    this.adminHash = this.source === 'env' ? this.envAdminHash : usableHash(auth.adminPasswordHash, 'webui.auth.adminPasswordHash');
    this.credentialEpoch = credentialEpochOf(this.adminHash);
    this.lastWriteAt = this.now();
  }

  /**
   * Hashes WEBUI_ADMIN_PASSWORD, so construction itself stays synchronous. Sessions wait for
   * `claimStore`, since a process that loses the port race must not overwrite the owner's store.
   */
  static async load(config: Config, source: ConfigSource, envAdminPassword: string | null): Promise<AuthService> {
    if (config.webui.auth.mode === 'none') return new AuthService(config, { source });
    const storedEnvAdminHash = readAuthFile(config.webui.port).envAdminHash;
    const envAdminHash = source === 'env' ? await resolveEnvAdminHash(envAdminPassword, storedEnvAdminHash) : storedEnvAdminHash;
    return new AuthService(config, { source, envAdminHash });
  }

  /**
   * Called once the port is owned. The previous owner may have changed the sessions since `load`,
   * so they come from a fresh read, and the write drops the dead ones. The jukebox code loads first,
   * since a guest session and a guest ban live only while their code does. A start in another mode drops the code, its
   * guests and their guest bans, so a later jukebox start never revives an old QR code.
   */
  claimStore(): void {
    const { file, droppedJukeboxCode } = readAuthFileWithStatus(this.port);
    if (this.mode === 'none') {
      this.dropStoredJukebox(file, droppedJukeboxCode);
      return;
    }
    const now = this.now();
    const keepsJukebox = this.mode === 'jukebox';
    if (keepsJukebox && droppedJukeboxCode) {
      logger.warn('webui: the stored jukebox code is unreadable, so the jukebox starts closed until the admin makes a new code');
    }
    const storedCode = file.jukeboxCode;
    this.jukeboxCode = keepsJukebox && storedCode !== null && storedCode.expiresAt > now ? storedCode : null;
    this.bans = file.bans.filter((ban) => ban.expiresAt > now && (this.jukeboxCode !== null || ban.kind !== 'guest'));
    for (const session of file.sessions) {
      if (this.isLive(session, now)) this.sessions.set(session.id, session);
    }
    this.persist();
  }

  hasAdminPassword(): boolean {
    return this.adminHash !== null;
  }

  async verifyAdminPassword(password: string): Promise<boolean> {
    if (this.adminHash === null) return false;
    return verifyPassword(password, this.adminHash);
  }

  /**
   * A heartbeat can swap the credential while the hash runs, so a password that matched the old
   * credential starts no session under the new one.
   */
  async login(password: string, address: string): Promise<MintedSession | null> {
    const verifiedEpoch = this.credentialEpoch;
    const matched = await this.verifyAdminPassword(password);
    if (!matched || verifiedEpoch !== this.credentialEpoch) return null;
    return this.createSession(address);
  }

  /** Every cookie of the session name is tried, since a stale one may come first. */
  findSession(req: IncomingMessage): SessionRecord | null {
    if (this.mode === 'none') return null;
    const now = this.now();
    for (const token of readCookieValues(req.headers.cookie, this.cookieName)) {
      const session = this.matchToken(token);
      if (session !== null && this.isLive(session, now)) return session;
    }
    return null;
  }

  /** Slides the idle expiry, which never passes the admin absolute cap or the guest's jukebox code expiry. */
  touch(session: SessionRecord, address: string): void {
    const now = this.now();
    session.lastSeenAt = now;
    session.expiresAt = session.role === 'admin'
      ? Math.min(now + ADMIN_IDLE_MS, session.createdAt + ADMIN_ABSOLUTE_MS)
      : Math.min(now + GUEST_IDLE_MS, this.jukeboxCode?.expiresAt ?? now);
    session.lastAddress = address;
    this.markDirty(now);
  }

  /** Returns the token, which only the cookie carries. The store keeps the secret's digest. */
  createSession(address: string): MintedSession {
    if (this.credentialEpoch === null) throw new Error('No admin password is set, so no admin session can start.');
    const now = this.now();
    const secret = randomToken(SESSION_SECRET_BYTES);
    const session: AdminSession = {
      id: randomToken(SESSION_ID_BYTES),
      secretDigest: sha256Hex(secret),
      role: 'admin',
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ADMIN_IDLE_MS,
      credentialEpoch: this.credentialEpoch,
      csrfToken: randomToken(CSRF_TOKEN_BYTES),
      lastAddress: address,
    };
    this.sessions.set(session.id, session);
    this.persist();
    return { token: `${session.id}.${secret}`, session };
  }

  deleteSession(sessionId: string): void {
    if (!this.removeSession(sessionId, null)) return;
    this.persist();
  }

  sessionCookie(token: string): string {
    return serializeSessionCookie(this.cookieName, token, ADMIN_ABSOLUTE_MS / 1000, this.secureCookie);
  }

  /**
   * A rotation can move a kept guest to a later code expiry, and no path re-sends its cookie, so the
   * cookie takes the longest code lifetime. The session's own expiry on the server bounds the access.
   */
  guestSessionCookie(token: string): string {
    return serializeSessionCookie(this.cookieName, token, (JUKEBOX_CODE_MAX_LIFETIME_HOURS * HOUR_MS) / 1000, this.secureCookie);
  }

  /** The first well-formed device cookie names the browser. A request with none gets a new id. */
  deviceOf(req: IncomingMessage): BrowserDevice {
    const presented = readCookieValues(req.headers.cookie, this.deviceCookieName).find((value) => DEVICE_ID_PATTERN.test(value));
    return presented === undefined ? { id: randomToken(DEVICE_ID_BYTES), presented: false } : { id: presented, presented: true };
  }

  deviceCookie(deviceId: string): string {
    return serializeDeviceCookie(this.deviceCookieName, deviceId, this.secureCookie);
  }

  hasJukeboxCode(): boolean {
    return this.liveJukeboxCode(this.now()) !== null;
  }

  jukeboxStatus(): JukeboxStatus {
    return this.statusOf(this.liveJukeboxCode(this.now()));
  }

  /**
   * The status and raw key come from one clock reading, so an expiry between them never shows an open
   * jukebox with no links. Only `GET /api/jukebox/code` and `POST /api/jukebox/key` send the key.
   */
  jukeboxShare(): JukeboxShare {
    const code = this.liveJukeboxCode(this.now());
    return { ...this.statusOf(code), key: code?.secret ?? null };
  }

  /**
   * A rotation that keeps the guests moves them to the new code, with their idle expiry capped by the
   * new code's expiry, and their numbering continues. Every rotation moves the guest bans to the new
   * code, so a new code never lets a banned browser back in.
   */
  createJukeboxCode(lifetimeHours: number, signOutGuests: boolean): { key: string; jukeboxCode: JukeboxCode; rotated: boolean } {
    const now = this.now();
    const previous = this.liveJukeboxCode(now);
    const kept = signOutGuests ? null : previous;
    const key = randomToken(JUKEBOX_CODE_BYTES);
    const jukeboxCode: JukeboxCode = {
      id: randomToken(JUKEBOX_CODE_ID_BYTES),
      secret: key,
      digest: sha256Hex(key),
      createdAt: now,
      expiresAt: now + lifetimeHours * HOUR_MS,
      lastGuestNumber: kept?.lastGuestNumber ?? 0,
    };
    for (const session of this.guestSessions()) {
      if (session.keyId === kept?.id) {
        session.keyId = jukeboxCode.id;
        session.expiresAt = Math.min(session.lastSeenAt + GUEST_IDLE_MS, jukeboxCode.expiresAt);
      } else {
        this.removeSession(session.id, this.endReasonOf(session, now, 'new-code'));
      }
    }
    // With no live code, a guest ban left over is one the sweep has not pruned yet.
    if (previous === null) {
      this.dropGuestBans();
    } else {
      for (const ban of this.bans) if (ban.kind === 'guest') ban.expiresAt = jukeboxCode.expiresAt;
    }
    this.jukeboxCode = jukeboxCode;
    this.persist();
    return { key, jukeboxCode, rotated: previous !== null };
  }

  /** Returns false when no live code existed. A code past its expiry that the sweep has not reached is still removed. */
  revokeJukeboxCode(): boolean {
    const live = this.liveJukeboxCode(this.now()) !== null;
    if (this.jukeboxCode !== null) {
      this.endJukebox('closed');
      this.persist();
    }
    return live;
  }

  /** Spends one join from the source's budget. Returns 0 then, or the wait in milliseconds. */
  takeJoinToken(budgetKey: string, publicSource: boolean): number {
    return (publicSource ? this.publicJoins : this.localJoins).tryTake(budgetKey);
  }

  /** Spends one name change from the guest session's budget. Returns 0 then, or the wait in milliseconds. */
  takeNicknameToken(sessionId: string): number {
    return this.nicknameChanges.tryTake(sessionId);
  }

  /** The store write is batched, as for a last-seen update. */
  setGuestNickname(session: GuestSession, nickname: string): void {
    session.nickname = nickname;
    this.markDirty(this.now());
  }

  /**
   * A banned browser is refused before its key is checked, so a new code tells it the same reason. A
   * requester that already holds a guest session for the current code keeps it, and a nickname it
   * sends is ignored. The nickname route changes a stored name, since a kept join spends no budget.
   */
  join(key: string, nickname: string | null, address: string, current: GuestSession | null, deviceId: string): JoinResult {
    const now = this.now();
    if (this.isDeviceBanned(deviceId, now)) return { kind: 'banned' };
    const jukeboxCode = this.matchLiveJukeboxCode(key, now);
    if (jukeboxCode === null) return { kind: 'invalid' };
    if (current !== null && current.keyId === jukeboxCode.id) {
      return { kind: 'kept', session: current };
    }
    if (this.countGuests(jukeboxCode) >= MAX_GUESTS_PER_CODE) return { kind: 'full' };

    jukeboxCode.lastGuestNumber += 1;
    const secret = randomToken(SESSION_SECRET_BYTES);
    const session: GuestSession = {
      id: randomToken(SESSION_ID_BYTES),
      secretDigest: sha256Hex(secret),
      role: 'guest',
      keyId: jukeboxCode.id,
      label: `Guest ${String(jukeboxCode.lastGuestNumber)}`,
      nickname,
      deviceId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: Math.min(now + GUEST_IDLE_MS, jukeboxCode.expiresAt),
      csrfToken: randomToken(CSRF_TOKEN_BYTES),
      lastAddress: address,
    };
    this.sessions.set(session.id, session);
    this.persist();
    return { kind: 'joined', token: `${session.id}.${secret}`, session };
  }

  /** An admin join mints nothing, so this check alone makes a dead link fail for the host too. */
  isLiveJukeboxCode(key: string): boolean {
    return this.matchLiveJukeboxCode(key, this.now()) !== null;
  }

  /** Null once the session is gone. An admin previews the guest page under the host label. */
  guestJukeboxFor(sessionId: string): GuestJukebox | null {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return null;
    const expiresAt = this.jukeboxCode?.expiresAt ?? null;
    return session.role === 'guest'
      ? { label: session.label, nickname: session.nickname, expiresAt, joinedAt: session.createdAt }
      : { label: HOST_JUKEBOX_LABEL, nickname: null, expiresAt, joinedAt: session.createdAt };
  }

  /** Online means an open stream, or a request within `GUEST_ONLINE_WINDOW_MS`. */
  listGuests(): GuestStatus[] {
    const now = this.now();
    return this.guestSessions()
      .filter((session) => this.isLive(session, now))
      .map((session) => ({
        session,
        online: this.streams.has(session.id) || now - session.lastSeenAt < GUEST_ONLINE_WINDOW_MS,
      }));
  }

  isLiveGuest(sessionId: string): boolean {
    return this.liveGuest(sessionId, this.now()) !== null;
  }

  /** Ends the guest session and its streams. The jukebox code still admits the guest. */
  signOutGuest(sessionId: string): GuestSession | null {
    const session = this.liveGuest(sessionId, this.now());
    if (session === null) return null;
    this.removeSession(session.id, 'removed');
    this.persist();
    return session;
  }

  /**
   * Ends the guest session and records a `guest` ban on its browser, plus a `network` ban when
   * `networkBanHours` is above 0. A network ban is refused on a loopback source, which no network ban
   * blocks, and on the requester's own network, since it would lock the admin out of the page that lifts it.
   */
  banGuest(sessionId: string, networkBanHours: number, requesterAddress: string | undefined): BanResult {
    const now = this.now();
    const jukeboxCode = this.liveJukeboxCode(now);
    const session = this.liveGuest(sessionId, now);
    if (jukeboxCode === null || session === null) return { kind: 'not-found' };
    const key = networkKey(session.lastAddress);
    if (networkBanHours > 0 && classifySource(session.lastAddress) === 'loopback') return { kind: 'loopback' };
    if (networkBanHours > 0 && key === networkKey(requesterAddress)) return { kind: 'own-network' };

    const bans = [this.newBan('guest', session, now, jukeboxCode.expiresAt)];
    this.removeSession(session.id, 'removed');
    if (networkBanHours > 0) {
      bans.push(this.newBan('network', session, now, now + networkBanHours * HOUR_MS));
      this.closeStreamsOn(key);
    }
    this.bans.push(...bans);
    this.persist();
    return { kind: 'banned', session, bans };
  }

  /** A network ban on one of these keys also blocks an admin device, so the ban panel warns about it. */
  adminNetworkKeys(): Set<string> {
    const now = this.now();
    const keys = new Set<string>();
    for (const session of this.sessions.values()) {
      if (session.role === 'admin' && this.isLive(session, now) && classifySource(session.lastAddress) !== 'loopback') {
        keys.add(networkKey(session.lastAddress));
      }
    }
    return keys;
  }

  /** Leaves out an expired ban that the sweep has not pruned yet. */
  listBans(): Ban[] {
    const now = this.now();
    return this.bans.filter((ban) => ban.expiresAt > now);
  }

  liftBan(banId: string): Ban | null {
    const ban = this.bans.find((candidate) => candidate.id === banId);
    if (ban === undefined) return null;
    this.bans = this.bans.filter((candidate) => candidate !== ban);
    this.persist();
    return ban;
  }

  /** Mode `none` has no bans, and a loopback source is the host, which no network ban blocks. */
  isNetworkBanned(remoteAddress: string | undefined): boolean {
    if (this.mode === 'none' || this.bans.length === 0) return false;
    if (classifySource(remoteAddress) === 'loopback') return false;
    const key = networkKey(remoteAddress);
    const now = this.now();
    return this.bans.some((ban) => ban.kind === 'network' && ban.networkKey === key && ban.expiresAt > now);
  }

  expiredSessionCookie(): string {
    return serializeSessionCookie(this.cookieName, '', 0, this.secureCookie);
  }

  isCsrfTokenValid(session: SessionRecord, presented: string | string[] | undefined): boolean {
    return typeof presented === 'string' && constantTimeEqual(presented, session.csrfToken);
  }

  /** Logout, expiry and a password change close the session's streams at once through this. */
  trackStream(sessionId: string, res: ServerResponse, address: string | undefined): void {
    let open = this.streams.get(sessionId);
    if (open === undefined) {
      open = new Map();
      this.streams.set(sessionId, open);
    }
    open.set(res, address);
    const tracked = open;
    res.once('close', () => {
      tracked.delete(res);
      if (tracked.size === 0 && this.streams.get(sessionId) === tracked) this.streams.delete(sessionId);
    });
  }

  /**
   * Runs on the SSE heartbeat, so an expired session, an expired jukebox code or a changed password
   * ends its streams within one beat.
   */
  sweep(): void {
    if (this.mode === 'none') return;
    this.refreshCredential();
    const now = this.now();
    let removed = false;
    if (this.jukeboxCode !== null && this.jukeboxCode.expiresAt <= now) {
      this.endJukebox('expired');
      removed = true;
      logger.info('webui: the jukebox code expired, so every guest was signed out');
    }
    for (const session of [...this.sessions.values()]) {
      if (this.isLive(session, now)) continue;
      removed = this.removeSession(session.id, session.role === 'guest' ? this.expiryReasonOf(session, now) : null) || removed;
    }
    const liveBans = this.bans.filter((ban) => ban.expiresAt > now);
    if (liveBans.length !== this.bans.length) {
      this.bans = liveBans;
      removed = true;
    }
    this.throttle.prune();
    this.publicJoins.prune();
    this.localJoins.prune();
    this.nicknameChanges.prune();
    if (removed || (this.dirty && now - this.lastWriteAt >= LAST_SEEN_FLUSH_MS)) this.persist();
  }

  /** Called at shutdown, to keep the last `lastSeenAt` values. */
  flush(): void {
    if (this.mode !== 'none' && this.dirty) this.persist();
  }

  private matchToken(token: string): SessionRecord | null {
    const separator = token.indexOf('.');
    if (separator <= 0) return null;
    const session = this.sessions.get(token.slice(0, separator));
    if (session === undefined) return null;
    return constantTimeEqual(sha256Hex(token.slice(separator + 1)), session.secretDigest) ? session : null;
  }

  private isLive(session: SessionRecord, now: number): boolean {
    if (session.expiresAt <= now) return false;
    if (session.role === 'guest') return this.onLiveCode(session, now);
    return this.credentialEpoch !== null && session.credentialEpoch === this.credentialEpoch;
  }

  private liveJukeboxCode(now: number): JukeboxCode | null {
    return this.jukeboxCode !== null && this.jukeboxCode.expiresAt > now ? this.jukeboxCode : null;
  }

  private statusOf(code: JukeboxCode | null): JukeboxStatus {
    return {
      active: code !== null,
      createdAt: code?.createdAt ?? null,
      expiresAt: code?.expiresAt ?? null,
      guestCount: code === null ? 0 : this.countGuests(code),
    };
  }

  /** The key is compared by its digest in constant time. */
  private matchLiveJukeboxCode(key: string, now: number): JukeboxCode | null {
    const jukeboxCode = this.liveJukeboxCode(now);
    return jukeboxCode !== null && constantTimeEqual(sha256Hex(key), jukeboxCode.digest) ? jukeboxCode : null;
  }

  private liveGuest(sessionId: string, now: number): GuestSession | null {
    const session = this.sessions.get(sessionId);
    return session?.role === 'guest' && this.isLive(session, now) ? session : null;
  }

  private isDeviceBanned(deviceId: string, now: number): boolean {
    return this.bans.some((ban) => ban.kind === 'guest' && ban.deviceId === deviceId && ban.expiresAt > now);
  }

  private newBan(kind: Ban['kind'], session: GuestSession, createdAt: number, expiresAt: number): Ban {
    return {
      id: randomToken(BAN_ID_BYTES),
      kind,
      label: session.label,
      nickname: session.nickname,
      networkKey: networkKey(session.lastAddress),
      deviceId: kind === 'guest' ? session.deviceId : null,
      createdAt,
      expiresAt,
    };
  }

  private guestSessions(): GuestSession[] {
    return [...this.sessions.values()].filter((session): session is GuestSession => session.role === 'guest');
  }

  private countGuests(jukeboxCode: JukeboxCode): number {
    const now = this.now();
    return this.guestSessions().filter((session) => session.keyId === jukeboxCode.id && this.isLive(session, now)).length;
  }

  /** Revocation and expiry both sign out every guest and close their streams. */
  private endJukebox(reason: GuestEndReason): void {
    const now = this.now();
    for (const session of this.guestSessions()) this.removeSession(session.id, this.endReasonOf(session, now, reason));
    this.jukeboxCode = null;
    this.dropGuestBans();
  }

  /**
   * A host action names itself to every guest of the live code, an idle one the sweep has not reached
   * included, since its code stops working too. A guest whose code is no longer live ended by the code's expiry.
   */
  private endReasonOf(session: GuestSession, now: number, reason: GuestEndReason): GuestEndReason {
    return this.onLiveCode(session, now) ? reason : 'expired';
  }

  /** Only a guest whose code is still live can have ended by its own idle expiry. */
  private expiryReasonOf(session: GuestSession, now: number): GuestEndReason {
    return this.onLiveCode(session, now) ? 'idle' : 'expired';
  }

  private onLiveCode(session: GuestSession, now: number): boolean {
    return this.liveJukeboxCode(now)?.id === session.keyId;
  }

  /** A guest ban lasts while the jukebox stays open, so it ends when the jukebox closes or expires. */
  private dropGuestBans(): void {
    this.bans = this.bans.filter((ban) => ban.kind !== 'guest');
  }

  /** The settings page writes a new hash to the store, and only a store-run player reads it back. */
  private refreshCredential(): void {
    if (this.source !== 'store') return;
    const saved = this.readSavedAdminHash();
    if (saved === undefined || saved === this.configuredHash) return;
    this.configuredHash = saved;
    this.adminHash = usableHash(saved, 'webui.auth.adminPasswordHash');
    const epoch = credentialEpochOf(this.adminHash);
    if (epoch === this.credentialEpoch) return;
    this.credentialEpoch = epoch;
    logger.info('webui: the admin password changed, so every admin session ended');
  }

  /**
   * The ban refuses each new request from the key, but a stream opened earlier from it would keep
   * pushing jukebox state, so it closes. A stream matches by the address it opened from, since its
   * session may have moved since. The sessions stay, so lifting the ban lets them back in. Until then
   * the ban shuts a guest out as a removal does, so its page shows the same reason.
   */
  private closeStreamsOn(key: string): void {
    for (const [sessionId, open] of this.streams) {
      const endReason = this.sessions.get(sessionId)?.role === 'guest' ? 'removed' : null;
      for (const [res, address] of open) {
        if (classifySource(address) !== 'loopback' && networkKey(address) === key) closeStream(res, endReason);
      }
    }
  }

  /** An admin session, or a guest cookie this browser replaced, has no page to tell, so its streams close with no reason. */
  private removeSession(sessionId: string, endReason: GuestEndReason | null): boolean {
    if (!this.sessions.delete(sessionId)) return false;
    for (const res of this.streams.get(sessionId)?.keys() ?? []) closeStream(res, endReason);
    this.streams.delete(sessionId);
    this.dirty = true;
    return true;
  }

  /** Batches the writes a request can repeat without limit. */
  private markDirty(now: number): void {
    this.dirty = true;
    if (now - this.lastWriteAt >= LAST_SEEN_FLUSH_MS) this.persist();
  }

  /**
   * Mode `none` keeps no sessions in memory, so the file keeps its admin sessions, network bans and
   * env hash for a later start with a login. A file with no jukebox state is left unwritten. An
   * unreadable code record counts as jukebox state, so the rewrite clears it.
   */
  private dropStoredJukebox(file: AuthFile, droppedJukeboxCode: boolean): void {
    const sessions = file.sessions.filter((session) => session.role === 'admin');
    const bans = file.bans.filter((ban) => ban.kind !== 'guest');
    const holdsJukebox =
      droppedJukeboxCode || file.jukeboxCode !== null || sessions.length !== file.sessions.length || bans.length !== file.bans.length;
    if (!holdsJukebox) return;
    this.writeStore({ ...file, sessions, jukeboxCode: null, bans });
  }

  private persist(): void {
    this.lastWriteAt = this.now();
    this.dirty = false;
    this.writeStore({
      version: 1,
      sessions: [...this.sessions.values()],
      envAdminHash: this.envAdminHash,
      jukeboxCode: this.jukeboxCode,
      bans: this.bans,
    });
  }

  private writeStore(file: AuthFile): void {
    try {
      writeAuthFile(this.port, file);
    } catch (err) {
      logger.warn('webui: failed to write the auth store, so sessions may not survive a restart:', err);
    }
  }
}
