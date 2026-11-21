/**
 * Navidrome MCP Server - open_jukebox_remote tool
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readSavedWebuiEndpoint, readSavedWebuiSettings, type Config } from '../config.js';
import { JUKEBOX_REMOTE_START_POLL_MS, JUKEBOX_REMOTE_START_TIMEOUT_MS } from '../constants/timeouts.js';
import { ErrorFormatter } from '../utils/error-formatter.js';
import { openBrowser } from '../utils/open-browser.js';
import { portConflictMessage, probeWebOwner, type WebOwnerProbe } from '../web/acquire.js';
import { TLS_LOCAL_ADDRESS_WARNING } from '../web/banner.js';
import { readLaunchKey, withLaunchKey } from '../web/launch-key.js';
import { jukeboxLogPath } from '../web/log-path.js';
import { ensureWebForPlayback } from '../web/spawn.js';
import { isLanReachable, listLanInterfaces, loopbackUrl } from '../webui/network.js';
import { adminPageUrl } from '../webui/page-paths.js';

interface OpenJukeboxRemoteResult {
  url: string;
  /** Addresses other devices on the network use. Empty when the player listens on this computer only. */
  lanUrls: string[];
  /** Set when the player serves HTTPS, so the AI can explain the browser's certificate warning. */
  tlsNote?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ensureWebForPlayback returns as soon as a child launches, so a spawned player is probed until it
 * answers. A spawned player that is still busy starting can time out a probe, which reads as foreign,
 * so only the last probe decides. Any other status probes once.
 */
async function waitForOwner(startup: Config['webui'], spawned: boolean): Promise<WebOwnerProbe> {
  const deadline = Date.now() + (spawned ? JUKEBOX_REMOTE_START_TIMEOUT_MS : 0);
  for (;;) {
    const probe = await probeWebOwner(startup, readSavedWebuiEndpoint);
    if (probe.outcome === 'ours' || Date.now() >= deadline) return probe;
    await sleep(JUKEBOX_REMOTE_START_POLL_MS);
  }
}

/** A spawned or re-run player reads settings.json, so its settings win when they name the port that answered. */
function playerWebui(port: number, startup: Config['webui']): Config['webui'] {
  const saved = readSavedWebuiSettings();
  return saved !== null && saved.port === port ? saved : startup;
}

export async function openJukeboxRemote(config: Config): Promise<OpenJukeboxRemoteResult> {
  try {
    const status = await ensureWebForPlayback(config);
    const probe = await waitForOwner(config.webui, status === 'spawned');
    if (probe.outcome === 'foreign') throw new Error(portConflictMessage(probe.port));
    if (probe.outcome === 'refused') {
      throw new Error(`The Jukebox Remote did not start. Its log is at ${jukeboxLogPath()}.`);
    }

    const webui = playerWebui(probe.port, config.webui);
    const url = adminPageUrl(loopbackUrl(probe.port, probe.secure));
    // A player this MCP spawned opens its own tab when auto-open is on, so a second tab would duplicate it.
    // Only the opened address carries the launch key, so the result never hands the key to the AI.
    if (!(status === 'spawned' && webui.autoOpenBrowser)) openBrowser(withLaunchKey(url, readLaunchKey(probe.port)));

    // A player older than the health `lan` field leaves it out, so the settings playerWebui picks decide.
    const lanReachable = probe.lan ?? isLanReachable(webui.host);
    const lanUrls = lanReachable
      ? listLanInterfaces(probe.port, probe.secure).map((iface) => adminPageUrl(iface.url))
      : [];
    return probe.secure ? { url, lanUrls, tlsNote: TLS_LOCAL_ADDRESS_WARNING } : { url, lanUrls };
  } catch (error) {
    throw new Error(ErrorFormatter.toolExecution('open_jukebox_remote', error));
  }
}
