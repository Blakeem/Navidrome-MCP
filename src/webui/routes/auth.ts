/**
 * Navidrome MCP Server - Web remote login, logout and session routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AdminLoginSchema, GuestJoinSchema } from '../../schemas/index.js';
import { logger } from '../../utils/logger.js';
import type { AuthService, BrowserDevice, MintedSession } from '../auth/auth-service.js';
import type { GuestSession, SessionRecord } from '../auth/auth-store.js';
import {
  isPasswordlessHere,
  outsideLevelMessage,
  principalRole,
  resolvePrincipal,
  sourcePassesLevel,
  type Principal,
} from '../auth/principal.js';
import { readValidBody, writeError, writeJson, writeTooManyRequests } from '../http-helpers.js';
import type { GuestQueue } from '../jukebox/guest-queue.js';
import type { QueuedNames } from '../jukebox/jukebox-names.js';
import { isLocalRequest } from '../loopback.js';
import { classifySource, networkKey, sourceAddress } from '../source-address.js';

const WRONG_PASSWORD = 'Wrong password';
const ENTER_PASSWORD = 'Enter the admin password.';
const INVALID_JUKEBOX_CODE = 'This jukebox code is not valid, closed or expired.';
const JUKEBOX_FULL = 'The jukebox is full. Ask the host to free a place.';
const BANNED_FROM_JUKEBOX = 'The host removed you from the jukebox.';
const NO_ADMIN_PASSWORD = 'No admin password is set.';
const OTHER_DEVICES_CANNOT_LOG_IN = 'Other devices cannot log in.';
const SET_ENV_ADMIN_PASSWORD = 'Set WEBUI_ADMIN_PASSWORD and restart the player.';
const SET_IN_ALL_SETTINGS = 'Set one in All settings.';
const ONLY_THIS_COMPUTER = 'Only this computer can log in as admin.';
const OPEN_FROM_SHORTCUT_HERE = 'Open the player from the Jukebox Remote desktop shortcut on this computer.';
const OPEN_FROM_SHORTCUT_THERE = "Open the player from the Jukebox Remote desktop shortcut on the player's computer to set one.";

/**
 * An env-run player reads its password only from WEBUI_ADMIN_PASSWORD, so All settings cannot set it.
 * The player's computer shows the text in its gear menu. The text for another device names the desktop
 * shortcut, since only a launcher's address carries the launch key the passwordless login needs.
 * At level `localhost` a saved password lets no other device in, so that text names no step to set one.
 */
function noAdminPasswordMessage(req: IncomingMessage, auth: AuthService): string {
  const isLocal = isLocalRequest(req);
  const isEnv = auth.source === 'env';
  if (isLocal && auth.adminAccess === 'localhost') return `${NO_ADMIN_PASSWORD} ${ONLY_THIS_COMPUTER}`;
  if (isLocal) return `${NO_ADMIN_PASSWORD} ${OTHER_DEVICES_CANNOT_LOG_IN} ${isEnv ? SET_ENV_ADMIN_PASSWORD : SET_IN_ALL_SETTINGS}`;
  if (isEnv) return `${NO_ADMIN_PASSWORD} ${SET_ENV_ADMIN_PASSWORD}`;
  return `${NO_ADMIN_PASSWORD} ${OPEN_FROM_SHORTCUT_THERE}`;
}

/**
 * The desktop shortcut runs with the desktop's environment, which may lack the variables of an env-run
 * player, so the env text also names the env password.
 */
function keylessLoginMessage(auth: AuthService): string {
  const message = `${NO_ADMIN_PASSWORD} ${OPEN_FROM_SHORTCUT_HERE}`;
  return auth.source === 'env' ? `${message} ${SET_ENV_ADMIN_PASSWORD}` : message;
}

/**
 * Public in every mode, so the page learns whether to show the login view before any gated call. An
 * admin session outside the access level reads as anonymous, with the refusal its owner can act on.
 * `isLocal` lets the page hide the system settings and Shut down, which only a local request holds.
 * `jukeboxOpen` tells an admin session's guest page whether the host can queue, or shows the closed card.
 * `noAdminPasswordMessage` reaches only a source that may log in. `passwordlessHere` tells the page to
 * post the login itself, and stays free of side effects, so a read mints no session.
 */
export function handleAuthSession(req: IncomingMessage, res: ServerResponse, auth: AuthService): void {
  const principal = resolvePrincipal(req, auth);
  const adminLoginAvailable = auth.mode !== 'none' && sourcePassesLevel(req, auth.adminAccess);
  writeJson(res, 200, {
    mode: auth.mode,
    role: principalRole(principal),
    ...(principal.kind === 'admin' || principal.kind === 'guest' ? { csrfToken: principal.session.csrfToken } : {}),
    ...(principal.kind === 'outside-level' ? { outsideLevelMessage: outsideLevelMessage(principal.level) } : {}),
    ...(principal.kind === 'admin' && auth.mode === 'jukebox' ? { jukeboxOpen: auth.hasJukeboxCode() } : {}),
    adminLoginAvailable,
    ...(adminLoginAvailable && !auth.hasAdminPassword() ? { noAdminPasswordMessage: noAdminPasswordMessage(req, auth) } : {}),
    ...(isPasswordlessHere(req, auth) ? { passwordlessHere: true } : {}),
    isLocal: isLocalRequest(req),
    yourAddress: sourceAddress(req.socket.remoteAddress),
  });
}

/**
 * A source outside the admin access level gets 404, so the internet never sees an admin login at
 * the default level. A source that cannot log in while no password is saved gets 503 before its body
 * is read. The body is read before the throttle starts an attempt, so a client that trickles its body
 * cannot hold the one attempt slot. The passwordless rule is checked again after the read, since the
 * heartbeat or another request may load a newly saved password or ask meanwhile. A request it admits
 * that carries the launch key skips the password and the throttle, and spends from its own budget instead.
 * One without the key gets the password login, since a tunnel or proxy on the host also passes the rule.
 * The level is checked again after the hash runs, since a newly saved level may have narrowed meanwhile.
 */
export async function handleLogin(req: IncomingMessage, res: ServerResponse, auth: AuthService): Promise<void> {
  if (auth.mode === 'none' || !sourcePassesLevel(req, auth.adminAccess)) {
    writeError(res, 404, 'Not found');
    return;
  }
  if (!isPasswordlessHere(req, auth) && !auth.hasAdminPassword()) {
    writeError(res, 503, noAdminPasswordMessage(req, auth));
    return;
  }
  const input = await readValidBody(req, res, AdminLoginSchema);
  if (input === null) return;

  const requester = networkKey(req.socket.remoteAddress);
  const address = sourceAddress(req.socket.remoteAddress);
  const isLocal = isLocalRequest(req);
  if (isPasswordlessHere(req, auth)) {
    if (auth.isLaunchKey(input.launchKey)) {
      writePasswordlessLogin(req, res, auth, requester);
      return;
    }
    if (!auth.hasAdminPassword()) {
      writeError(res, 503, keylessLoginMessage(auth));
      return;
    }
    // The page posts an empty password when it holds no valid key, and this 401 shows it the password form.
    if (input.password === '') {
      writeError(res, 401, ENTER_PASSWORD);
      return;
    }
  }
  const waitMs = auth.throttle.tryBegin(requester, isLocal);
  if (waitMs > 0) {
    writeTooManyRequests(res, waitMs, 'login attempts');
    return;
  }

  let login: MintedSession | null = null;
  try {
    login = await auth.login(input.password, address, isLocal);
  } finally {
    auth.throttle.finish(login !== null);
  }
  if (login === null) {
    logger.warn(`webui: admin login failed from ${requester}`);
    writeError(res, 401, WRONG_PASSWORD);
    return;
  }
  if (!sourcePassesLevel(req, auth.adminAccess)) {
    auth.deleteSession(login.session.id);
    writeError(res, 404, 'Not found');
    return;
  }

  writeAdminLogin(req, res, auth, login);
  logger.info(`webui: admin login from ${requester}`);
}

function writePasswordlessLogin(req: IncomingMessage, res: ServerResponse, auth: AuthService, requester: string): void {
  const waitMs = auth.takePasswordlessLoginToken(requester);
  if (waitMs > 0) {
    writeTooManyRequests(res, waitMs, 'passwordless logins');
    return;
  }
  writeAdminLogin(req, res, auth, auth.createPasswordlessSession(sourceAddress(req.socket.remoteAddress), isLocalRequest(req)));
  logger.info(`webui: admin login with no password from ${requester} on the player's computer`);
}

function writeAdminLogin(req: IncomingMessage, res: ServerResponse, auth: AuthService, login: MintedSession): void {
  // The admin cookie replaces a guest cookie in this browser, so that guest session would idle on and fill a guest place.
  const replaced = resolvePrincipal(req, auth);
  if (replaced.kind === 'guest') auth.deleteSession(replaced.session.id);
  res.setHeader('Set-Cookie', auth.sessionCookie(login.token));
  writeJson(res, 200, { role: login.session.role, csrfToken: login.session.csrfToken });
}

/** Mode none reaches this with the open principal, which holds no session, so only the cookie is expired. */
export function handleLogout(req: IncomingMessage, res: ServerResponse, auth: AuthService, principal: Principal): void {
  if (principal.kind === 'admin' || principal.kind === 'guest') {
    auth.deleteSession(principal.session.id);
    logger.info(`webui: ${principal.kind} logout from ${networkKey(req.socket.remoteAddress)}`);
  }
  res.setHeader('Set-Cookie', auth.expiredSessionCookie());
  writeJson(res, 200, { ok: true });
}

/**
 * Public in mode `jukebox`, so a guest page with the code from the QR code signs in. An admin the
 * access level admits already queues from the guest page as the host, so for the live code its
 * session stays and no guest session is minted for it. Neither the code nor the device id reaches a log.
 */
export async function handleJoin(req: IncomingMessage, res: ServerResponse, auth: AuthService, guests: Pick<GuestQueue, 'ledger'>): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex');
  if (auth.mode !== 'jukebox') {
    writeError(res, 404, 'Not found');
    return;
  }
  const input = await readValidBody(req, res, GuestJoinSchema);
  if (input === null) return;

  const principal = resolvePrincipal(req, auth);
  const requester = networkKey(req.socket.remoteAddress);
  if (principal.kind === 'admin') {
    if (auth.isLiveJukeboxCode(input.key)) writeJoinReply(res, auth, principal.session);
    else writeInvalidJoin(res, requester);
    return;
  }
  const address = sourceAddress(req.socket.remoteAddress);
  const nickname = input.nickname ?? null;
  const device = auth.deviceOf(req);
  const current = principal.kind === 'guest' ? principal.session : null;
  // The ledger can hold thousands of admin page songs, so the names are read only for a join that names itself.
  const queuedNames = (): QueuedNames => guests.ledger.addedByNames();
  // A guest session is live only under the live code, so this join mints nothing.
  const rejoin = current === null ? null : auth.join(input.key, nickname, address, current, device.id, queuedNames);
  // A guest that rejoins with the live code keeps its session and spends no join from its network's budget.
  if (rejoin?.kind !== 'kept') {
    const publicSource = classifySource(req.socket.remoteAddress) === 'public';
    // Every device on one LAN shares an IPv6 /64, so the address keys a LAN budget.
    const waitMs = auth.takeJoinToken(publicSource ? requester : address, publicSource);
    if (waitMs > 0) {
      writeTooManyRequests(res, waitMs, 'join attempts');
      return;
    }
  }

  const result = rejoin ?? auth.join(input.key, nickname, address, null, device.id, queuedNames);
  switch (result.kind) {
    case 'invalid':
      writeInvalidJoin(res, requester);
      return;
    case 'banned':
      logger.warn(`webui: jukebox join refused from ${requester}, since the host banned this browser`);
      writeError(res, 403, BANNED_FROM_JUKEBOX);
      return;
    case 'full':
      logger.warn(`webui: jukebox join refused from ${requester}, since the jukebox is full`);
      writeError(res, 403, JUKEBOX_FULL);
      return;
    case 'name-taken':
      writeError(res, 400, result.message);
      return;
    case 'kept': {
      const cookies = deviceCookies(auth, device, result.session);
      if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);
      writeJoinReply(res, auth, result.session);
      return;
    }
    case 'joined':
      // The guest cookie replaces this browser's admin cookie, so that admin session would idle on unreachable.
      if (principal.kind === 'outside-level') auth.deleteSession(principal.session.id);
      logger.info(`webui: jukebox join from ${requester} as ${result.session.label}`);
      res.setHeader('Set-Cookie', [auth.guestSessionCookie(result.token), ...deviceCookies(auth, device, result.session)]);
      writeJoinReply(res, auth, result.session);
      return;
  }
}

/** A browser that sent no usable device cookie gets the one its session holds, so a later ban can block it. */
function deviceCookies(auth: AuthService, device: BrowserDevice, session: GuestSession): string[] {
  return device.presented || session.deviceId === null ? [] : [auth.deviceCookie(session.deviceId)];
}

function writeJoinReply(res: ServerResponse, auth: AuthService, session: SessionRecord): void {
  writeJson(res, 200, { role: session.role, csrfToken: session.csrfToken, ...auth.guestJukeboxFor(session.id) });
}

function writeInvalidJoin(res: ServerResponse, requester: string): void {
  logger.warn(`webui: jukebox join refused from ${requester}`);
  writeError(res, 403, INVALID_JUKEBOX_CODE);
}
