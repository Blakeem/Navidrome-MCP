/**
 * Navidrome MCP Server - Web remote jukebox code routes
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { renderSVG } from 'uqr';
import { saveJukeboxSettings, type Config } from '../../config.js';
import { JukeboxCodeCreateSchema, JukeboxSettingsPatchSchema } from '../../schemas/index.js';
import type { JukeboxShareLink } from '../../constants/defaults.js';
import { logger } from '../../utils/logger.js';
import { getGuestQueueLimit, getJukeboxShareLink, setGuestQueueLimit, setJukeboxShareLink } from '../../web/player-runtime.js';
import type { AuthService } from '../auth/auth-service.js';
import type { SseBroadcaster } from '../broadcaster.js';
import { readValidBody, writeError, writeJson } from '../http-helpers.js';
import { isLanReachable, listLanInterfaces } from '../network.js';
import { GUEST_PAGE_PATH } from '../page-paths.js';
import { networkKey } from '../source-address.js';
import { isTlsEnabled } from '../tls.js';

const LOOPBACK_ONLY =
  'No address reaches guests, since the web remote listens on this computer only. ' +
  'Turn on Expose on LAN in navidrome-config, then restart the player.';
const NO_LAN_ADDRESS =
  'No LAN IPv4 address was found. Connect this computer to the network, or set webui.publicUrl in navidrome-config.';

interface JoinBases {
  lan: Array<{ label: string; origin: string }>;
  internet: string | null;
}

interface JoinLink {
  url: string;
  qrSvg: string;
}

interface JukeboxCodeView {
  active: boolean;
  expiresAt: number | null;
  guestCount: number;
  links: { lan: Array<JoinLink & { label: string }>; internet: JoinLink | null };
  /** Why an open code has no link, so the dialog names the fix for the cause. */
  problem: string | null;
}

/** A loopback bind refuses every other Host header, so it has no address a guest can use. */
function joinBases(config: Config): JoinBases {
  const { webui } = config;
  if (!isLanReachable(webui.host)) return { lan: [], internet: null };
  return {
    lan: listLanInterfaces(webui.port, isTlsEnabled(webui.tls)).map((lan) => ({ label: `${lan.iface} · ${lan.address}`, origin: lan.url })),
    internet: webui.publicUrl === null ? null : new URL(webui.publicUrl).origin,
  };
}

/** Null when some address reaches guests. */
function noLinkReason(config: Config, bases: JoinBases): string | null {
  if (bases.lan.length > 0 || bases.internet !== null) return null;
  return isLanReachable(config.webui.host) ? NO_LAN_ADDRESS : LOOPBACK_ONLY;
}

/** The key rides in the fragment, which a browser never sends to a server, a referrer or a link preview. */
function joinLink(origin: string, key: string): JoinLink {
  const url = `${origin}${GUEST_PAGE_PATH}#k=${key}`;
  return { url, qrSvg: renderSVG(url, { ecc: 'M', border: 4 }) };
}

/**
 * Callers read the bases on each request, so a link follows an address change made after the code,
 * such as Expose on LAN turned off while a code from the per-port auth file is still live.
 */
function buildCodeView(auth: AuthService, config: Config, bases: JoinBases): JukeboxCodeView {
  const { active, expiresAt, guestCount, key } = auth.jukeboxShare();
  if (key === null) return { active, expiresAt, guestCount, links: { lan: [], internet: null }, problem: null };
  return {
    active,
    expiresAt,
    guestCount,
    links: {
      lan: bases.lan.map(({ label, origin }) => ({ label, ...joinLink(origin, key) })),
      internet: bases.internet === null ? null : joinLink(bases.internet, key),
    },
    problem: noLinkReason(config, bases),
  };
}

/** A key-free status read. `GET /api/jukebox/code` is the read that carries the key. */
export function handleGetJukeboxStatus(res: ServerResponse, auth: AuthService): void {
  writeJson(res, 200, auth.jukeboxStatus());
}

/** The only read that carries the key. `writeJson` sends `Cache-Control: no-store`. */
export function handleGetJukeboxCode(res: ServerResponse, auth: AuthService, config: Config): void {
  writeJson(res, 200, buildCodeView(auth, config, joinBases(config)));
}

/**
 * Every link in one list, the internet one first, as the create answer listed them before the code
 * route existed. API callers of that answer read it.
 */
function joinUrlsOf(links: JukeboxCodeView['links']): Array<JoinLink & { label: string }> {
  const internet = links.internet === null ? [] : [{ label: 'Internet', ...links.internet }];
  return [...internet, ...links.lan];
}

/**
 * Answers with the code route's view of the new code plus `joinUrls`. A kept guest's page reads its
 * new expiry from a snapshot, and a paused player sends none, so one goes out now.
 */
export async function handleCreateJukeboxCode(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
  config: Config,
  broadcaster: Pick<SseBroadcaster, 'broadcastNow'>,
): Promise<void> {
  const input = await readValidBody(req, res, JukeboxCodeCreateSchema);
  if (input === null) return;
  const bases = joinBases(config);
  const problem = noLinkReason(config, bases);
  if (problem !== null) {
    writeError(res, 409, problem);
    return;
  }

  const { rotated } = auth.createJukeboxCode(input.lifetimeHours, input.signOutGuests);
  const guestsNote = input.signOutGuests ? 'guests signed out' : 'guests kept';
  const action = rotated ? `rotated (${guestsNote})` : 'created';
  logger.info(`webui: jukebox code ${action} from ${networkKey(req.socket.remoteAddress)} for ${String(input.lifetimeHours)} h`);
  broadcaster.broadcastNow();
  const view = buildCodeView(auth, config, bases);
  writeJson(res, 200, { ...view, joinUrls: joinUrlsOf(view.links) });
}

function jukeboxSettings(): { guestQueueLimit: number; shareLink: JukeboxShareLink } {
  return { guestQueueLimit: getGuestQueueLimit(), shareLink: getJukeboxShareLink() };
}

export function handleGetJukeboxSettings(res: ServerResponse): void {
  writeJson(res, 200, jukeboxSettings());
}

/**
 * Each sent field applies at once, and every guest page learns a new song limit from a snapshot sent
 * now. `persisted` is false when the change holds until the player restarts.
 */
export async function handleSetJukeboxSettings(
  req: IncomingMessage,
  res: ServerResponse,
  broadcaster: Pick<SseBroadcaster, 'broadcastNow'>,
): Promise<void> {
  const input = await readValidBody(req, res, JukeboxSettingsPatchSchema);
  if (input === null) return;
  const source = networkKey(req.socket.remoteAddress);
  if (input.guestQueueLimit !== undefined) {
    setGuestQueueLimit(input.guestQueueLimit);
    logger.info(`webui: guest song limit set to ${String(input.guestQueueLimit)} from ${source}`);
  }
  if (input.shareLink !== undefined) {
    setJukeboxShareLink(input.shareLink);
    logger.info(`webui: jukebox share link set to ${input.shareLink} from ${source}`);
  }
  const persisted = saveJukeboxSettings(input);
  if (!persisted) logger.warn('jukebox settings: settings.json was not written, so the change holds until the player restarts');
  if (input.guestQueueLimit !== undefined) broadcaster.broadcastNow();
  writeJson(res, 200, { ...jukeboxSettings(), persisted });
}

export function handleRevokeJukeboxCode(req: IncomingMessage, res: ServerResponse, auth: AuthService): void {
  const revoked = auth.revokeJukeboxCode();
  if (revoked) logger.info(`webui: jukebox code revoked from ${networkKey(req.socket.remoteAddress)}, so every guest was signed out`);
  writeJson(res, 200, { ok: true, revoked });
}
