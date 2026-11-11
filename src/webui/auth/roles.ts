/**
 * Navidrome MCP Server - Web remote permissions and roles
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { WebuiAdminAccess, WebuiAuthMode } from '../../constants/defaults.js';
import { classifySource } from '../source-address.js';

/** Each dispatcher route in `src/webui/server.ts` names one of these, or `public`. */
const PERMISSIONS = [
  'player.view',
  'player.media',
  'player.control',
  'player.output',
  'library.browse',
  'host.info',
  'player.settings',
  'player.power',
  'auth.self',
  'jukebox.view',
  'jukebox.manage',
  'jukebox.queue',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

type SessionRole = 'admin' | 'guest';

/** The admin holds `jukebox.queue` too, so it queues from the guest page as the host under the guest rules. */
const ROLE_PERMISSIONS: Readonly<Record<SessionRole, ReadonlySet<Permission>>> = {
  admin: new Set(PERMISSIONS),
  guest: new Set(['jukebox.view', 'jukebox.queue', 'auth.self', 'player.media']),
};

/** The system settings and Shut down change the player's computer, so only a local request holds them in every mode. */
const LOCAL_ONLY: ReadonlySet<Permission> = new Set(['player.settings', 'player.power']);
/** Only mode `jukebox` has guests, so the jukebox routes do not exist in modes `none` and `password`. */
const JUKEBOX_ONLY: ReadonlySet<Permission> = new Set(['jukebox.view', 'jukebox.manage', 'jukebox.queue']);

export function roleHolds(role: SessionRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function modeHasPermission(mode: WebuiAuthMode, permission: Permission): boolean {
  return mode === 'jukebox' || !JUKEBOX_ONLY.has(permission);
}

export function sourceAdmits(permission: Permission, isLocal: boolean): boolean {
  return isLocal || !LOCAL_ONLY.has(permission);
}

/**
 * `localhost` needs the same proof as the loopback-only routes, so a same-host proxy never counts as local.
 * `isLocal` is that proof for the request, and `remoteAddress` its peer.
 */
export function levelAdmits(level: WebuiAdminAccess, isLocal: boolean, remoteAddress: string | undefined): boolean {
  if (level === 'anywhere' || isLocal) return true;
  return level === 'lan' && classifySource(remoteAddress) === 'lan';
}
