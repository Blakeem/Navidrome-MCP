/**
 * Navidrome MCP Server - Web remote permissions and roles
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { WebuiAuthMode } from '../../constants/defaults.js';

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

/** The guest song limit and its ledger count guest sessions, so the admin queues through the host routes instead. */
const GUEST_ONLY: ReadonlySet<Permission> = new Set(['jukebox.queue']);

const ROLE_PERMISSIONS: Readonly<Record<SessionRole, ReadonlySet<Permission>>> = {
  admin: new Set(PERMISSIONS.filter((permission) => !GUEST_ONLY.has(permission))),
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
