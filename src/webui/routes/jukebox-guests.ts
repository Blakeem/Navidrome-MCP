/**
 * Navidrome MCP Server - Web remote guest management and ban routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { JukeboxBanRemoveSchema, JukeboxGuestBanSchema, JukeboxGuestRemoveSchema } from '../../schemas/index.js';
import { logger } from '../../utils/logger.js';
import type { AuthService, GuestStatus } from '../auth/auth-service.js';
import type { Ban } from '../auth/auth-store.js';
import type { GuestQueue } from '../jukebox/guest-queue.js';
import { readValidBody, writeError, writeJson } from '../http-helpers.js';
import { classifySource, networkKey } from '../source-address.js';

const GUEST_GONE = 'That guest is no longer signed in.';
const BAN_GONE = 'That ban was already lifted or has expired.';
const LOOPBACK_NETWORK_BAN =
  'That guest connects from this computer, which a network ban never blocks, so it would have no effect. Ban without a network ban instead.';
const OWN_NETWORK_BAN =
  'That guest shares your network address, so a network ban would lock you out too. Ban without a network ban instead.';

type Guests = Pick<GuestQueue, 'unplayedSongs'>;

interface KeyStats {
  guestCounts: ReadonlyMap<string, number>;
  adminKeys: ReadonlySet<string>;
}

function guestView({ session, online }: GuestStatus, guests: Guests, { guestCounts, adminKeys }: KeyStats): Record<string, unknown> {
  const key = networkKey(session.lastAddress);
  return {
    sessionId: session.id,
    label: session.label,
    nickname: session.nickname,
    online,
    joinedAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    networkKey: key,
    addressClass: classifySource(session.lastAddress),
    sharedCount: (guestCounts.get(key) ?? 1) - 1,
    adminShares: adminKeys.has(key),
    songs: guests.unplayedSongs(session.id).map(({ title, artist }) => ({ title: title ?? null, artist: artist ?? null })),
  };
}

/** The device id names a guest's browser, so it stays out of every response. */
function banView(ban: Ban): Record<string, unknown> {
  return {
    id: ban.id,
    kind: ban.kind,
    label: ban.label,
    nickname: ban.nickname,
    networkKey: ban.networkKey,
    createdAt: ban.createdAt,
    expiresAt: ban.expiresAt,
  };
}

/**
 * `sharedCount` and `adminShares` let the panel warn that a network ban on this guest's address also
 * blocks those guests or an admin device.
 */
export function handleListGuests(res: ServerResponse, auth: AuthService, guests: Guests): void {
  const statuses = auth.listGuests();
  const guestCounts = new Map<string, number>();
  for (const { session } of statuses) {
    const key = networkKey(session.lastAddress);
    guestCounts.set(key, (guestCounts.get(key) ?? 0) + 1);
  }
  const stats: KeyStats = { guestCounts, adminKeys: auth.adminNetworkKeys() };
  writeJson(res, 200, { guests: statuses.map((status) => guestView(status, guests, stats)) });
}

/** The guest's songs stay queued, and the jukebox code lets the guest join again. */
export async function handleRemoveGuest(req: IncomingMessage, res: ServerResponse, auth: AuthService): Promise<void> {
  const input = await readValidBody(req, res, JukeboxGuestRemoveSchema);
  if (input === null) return;
  const session = auth.signOutGuest(input.sessionId);
  if (session === null) {
    writeError(res, 404, GUEST_GONE);
    return;
  }
  logger.info(`webui: ${session.label} (${networkKey(session.lastAddress)}) was signed out by the host`);
  writeJson(res, 200, { ok: true });
}

/**
 * The ban lands before the songs leave, so the guest loses access even when mpv fails. `songsStayed`
 * counts the queued songs no attached mpv could remove. A failed removal answers null for both and
 * leaves the cause in the log.
 */
export async function handleBanGuest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  guests: Pick<GuestQueue, 'removeGuestSongs'>,
): Promise<void> {
  const input = await readValidBody(req, res, JukeboxGuestBanSchema);
  if (input === null) return;
  const result = auth.banGuest(input.sessionId, input.networkBanHours, req.socket.remoteAddress);
  if (result.kind === 'not-found') {
    writeError(res, 404, GUEST_GONE);
    return;
  }
  if (result.kind === 'loopback') {
    writeError(res, 400, LOOPBACK_NETWORK_BAN);
    return;
  }
  if (result.kind === 'own-network') {
    writeError(res, 400, OWN_NETWORK_BAN);
    return;
  }

  const { session, bans } = result;
  const networkNote = input.networkBanHours > 0 ? `, network banned for ${String(input.networkBanHours)} h` : '';
  logger.info(`webui: ${session.label} (${networkKey(session.lastAddress)}) was banned by the host${networkNote}`);
  let songsRemoved: number | null = null;
  let songsStayed: number | null = null;
  try {
    const removal = await guests.removeGuestSongs(session.id);
    songsRemoved = removal.removed;
    songsStayed = removal.stayed;
    if (removal.stayed > 0) {
      logger.warn(`webui: no player is attached, so ${String(removal.stayed)} queued songs of banned ${session.label} stay in the queue`);
    }
  } catch (err) {
    logger.warn(`webui: the songs of banned ${session.label} were not removed from the queue: ${err instanceof Error ? err.message : String(err)}`);
  }
  writeJson(res, 200, { ok: true, bans: bans.map(banView), songsRemoved, songsStayed });
}

export function handleListBans(res: ServerResponse, auth: AuthService): void {
  writeJson(res, 200, { bans: auth.listBans().map(banView) });
}

export async function handleRemoveBan(req: IncomingMessage, res: ServerResponse, auth: AuthService): Promise<void> {
  const input = await readValidBody(req, res, JukeboxBanRemoveSchema);
  if (input === null) return;
  const ban = auth.liftBan(input.banId);
  if (ban === null) {
    writeError(res, 404, BAN_GONE);
    return;
  }
  logger.info(`webui: the ${ban.kind} ban on ${ban.label} (${ban.networkKey}) was lifted by the host`);
  writeJson(res, 200, { ok: true });
}
