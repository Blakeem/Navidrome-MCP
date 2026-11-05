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
import { outsideLevelMessage, principalRole, resolvePrincipal, sourcePassesLevel, type Principal } from '../auth/principal.js';
import { readValidBody, writeError, writeJson, writeTooManyRequests } from '../http-helpers.js';
import type { GuestQueue } from '../jukebox/guest-queue.js';
import type { QueuedNames } from '../jukebox/jukebox-names.js';
import { isLocalRequest } from '../loopback.js';
import { classifySource, networkKey, sourceAddress } from '../source-address.js';

const WRONG_PASSWORD = 'Wrong password';
const INVALID_JUKEBOX_CODE = 'This jukebox code is not valid, closed or expired.';
const JUKEBOX_FULL = 'The jukebox is full. Ask the host to free a place.';
const BANNED_FROM_JUKEBOX = 'The host removed you from the jukebox.';
const NO_ADMIN_PASSWORD =
  'No admin password is set. Set one on the settings page (navidrome-config), or set WEBUI_ADMIN_PASSWORD when the ' +
  'player runs from environment variables, then restart the player.';

/**
 * Public in every mode, so the page learns whether to show the login view before any gated call. An
 * admin session outside the access level reads as anonymous, with the refusal its owner can act on.
 * `isLocal` lets the page hide the system settings and Shut down, which only a local request holds.
 * `jukeboxOpen` tells an admin session's guest page whether the host can queue, or shows the closed card.
 */
export function handleAuthSession(req: IncomingMessage, res: ServerResponse, auth: AuthService): void {
  const principal = resolvePrincipal(req, auth);
  writeJson(res, 200, {
    mode: auth.mode,
    role: principalRole(principal),
    ...(principal.kind === 'admin' || principal.kind === 'guest' ? { csrfToken: principal.session.csrfToken } : {}),
    ...(principal.kind === 'outside-level' ? { outsideLevelMessage: outsideLevelMessage(principal.level) } : {}),
    ...(principal.kind === 'admin' && auth.mode === 'jukebox' ? { jukeboxOpen: auth.hasJukeboxCode() } : {}),
    adminLoginAvailable: auth.mode !== 'none' && sourcePassesLevel(req, auth.adminAccess),
    isLocal: isLocalRequest(req),
    yourAddress: sourceAddress(req.socket.remoteAddress),
  });
}

/**
 * A source outside the admin access level gets 404, so the internet never sees an admin login at
 * the default level. The body is read before the throttle starts an attempt, so a client that
 * trickles its body cannot hold the one attempt slot.
 */
export async function handleLogin(req: IncomingMessage, res: ServerResponse, auth: AuthService): Promise<void> {
  if (auth.mode === 'none' || !sourcePassesLevel(req, auth.adminAccess)) {
    writeError(res, 404, 'Not found');
    return;
  }
  if (!auth.hasAdminPassword()) {
    writeError(res, 503, NO_ADMIN_PASSWORD);
    return;
  }
  const input = await readValidBody(req, res, AdminLoginSchema);
  if (input === null) return;

  const requester = networkKey(req.socket.remoteAddress);
  const waitMs = auth.throttle.tryBegin(requester, isLocalRequest(req));
  if (waitMs > 0) {
    writeTooManyRequests(res, waitMs, 'login attempts');
    return;
  }

  let login: MintedSession | null = null;
  try {
    login = await auth.login(input.password, sourceAddress(req.socket.remoteAddress));
  } finally {
    auth.throttle.finish(login !== null);
  }
  if (login === null) {
    logger.warn(`webui: admin login failed from ${requester}`);
    writeError(res, 401, WRONG_PASSWORD);
    return;
  }

  // The admin cookie replaces a guest cookie in this browser, so that guest session would idle on and fill a guest place.
  const replaced = resolvePrincipal(req, auth);
  if (replaced.kind === 'guest') auth.deleteSession(replaced.session.id);
  logger.info(`webui: admin login from ${requester}`);
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
