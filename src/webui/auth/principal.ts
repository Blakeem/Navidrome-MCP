/**
 * Navidrome MCP Server - Web remote principal resolver
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage } from 'node:http';
import type { WebuiAdminAccess, WebuiAuthMode } from '../../constants/defaults.js';
import { isLocalRequest } from '../loopback.js';
import { classifySource } from '../source-address.js';
import type { AuthService } from './auth-service.js';
import type { AdminSession, GuestSession } from './auth-store.js';
import { modeHasPermission, roleHolds, sourceAdmits, type Permission } from './roles.js';

/**
 * `open` is mode `none`. `anonymous` holds no valid session in a mode with a login. `outside-level`
 * presents a valid admin session from a source the admin access level does not admit. A guest
 * session answers to the jukebox code, never to the admin access level. `isLocal` gates the
 * local-only permissions, which no guest role holds.
 */
export type Principal =
  | { kind: 'open'; isLocal: boolean }
  | { kind: 'anonymous' }
  | { kind: 'outside-level'; level: WebuiAdminAccess; session: AdminSession }
  | { kind: 'admin'; session: AdminSession; isLocal: boolean }
  | { kind: 'guest'; session: GuestSession };

type Authorization = { ok: true } | { ok: false; status: number; body: { error: string; code?: string } };

const ACCESS_LEVEL_LABELS: Readonly<Record<WebuiAdminAccess, string>> = {
  localhost: 'this computer',
  lan: 'the local network',
  anywhere: 'anywhere',
};

const FORBIDDEN: Authorization = { ok: false, status: 403, body: { error: 'Forbidden' } };
const NOT_FOUND: Authorization = { ok: false, status: 404, body: { error: 'Not found' } };

/** `localhost` needs the same proof as the loopback-only routes, so a same-host proxy never counts as local. */
export function sourcePassesLevel(req: IncomingMessage, level: WebuiAdminAccess): boolean {
  if (level === 'anywhere') return true;
  if (isLocalRequest(req)) return true;
  return level === 'lan' && classifySource(req.socket.remoteAddress) === 'lan';
}

export function resolvePrincipal(req: IncomingMessage, auth: AuthService): Principal {
  if (auth.mode === 'none') return { kind: 'open', isLocal: isLocalRequest(req) };
  const session = auth.findSession(req);
  if (session === null) return { kind: 'anonymous' };
  if (session.role === 'guest') return { kind: 'guest', session };
  if (!sourcePassesLevel(req, auth.adminAccess)) return { kind: 'outside-level', level: auth.adminAccess, session };
  return { kind: 'admin', session, isLocal: isLocalRequest(req) };
}

/**
 * A route the mode lacks answers 404 to every principal, and so does a local-only route that a
 * non-local open principal or admin session asks for, so the route stays hidden.
 */
export function authorize(mode: WebuiAuthMode, principal: Principal, permission: Permission): Authorization {
  if (!modeHasPermission(mode, permission)) return NOT_FOUND;
  switch (principal.kind) {
    case 'open':
      return sourceAdmits(permission, principal.isLocal) ? { ok: true } : NOT_FOUND;
    case 'anonymous':
      return { ok: false, status: 401, body: { error: 'Log in to use the web remote.', code: 'login' } };
    case 'outside-level':
      return { ok: false, status: 403, body: { error: outsideLevelMessage(principal.level) } };
    case 'admin':
      if (!sourceAdmits(permission, principal.isLocal)) return NOT_FOUND;
      return roleHolds(principal.session.role, permission) ? { ok: true } : FORBIDDEN;
    case 'guest':
      return roleHolds(principal.session.role, permission) ? { ok: true } : FORBIDDEN;
  }
}

/** Only the owner holds an admin session, so this refusal may name the settings page. */
export function outsideLevelMessage(level: WebuiAdminAccess): string {
  return `Admin access is limited to ${ACCESS_LEVEL_LABELS[level]} (admin access level "${level}"). ` +
    'Widen it on the settings page to use this session from here.';
}

/** The role the session route reports, so the page can pick the login view, the guest page or the player. */
export function principalRole(principal: Principal): 'open' | 'admin' | 'guest' | 'anonymous' {
  if (principal.kind === 'open' || principal.kind === 'admin' || principal.kind === 'guest') return principal.kind;
  return 'anonymous';
}
