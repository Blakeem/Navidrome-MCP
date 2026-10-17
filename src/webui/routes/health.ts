/**
 * Navidrome MCP Server - Web UI Health Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import { playbackEngine } from '../../services/playback/playback-engine.js';
import { getPackageVersion } from '../../utils/version.js';
import { writeError, writeJson } from '../http-helpers.js';
import { isLocalRequest } from '../loopback.js';
import { isLanReachable } from '../network.js';

/** The port-as-lock probe tells a navidrome-web owner from a foreign process by this value. */
export const HEALTH_APP_ID = 'navidrome-mcp-web';

/**
 * `scrobbleClaims` tells an MCP tracker that this owner submits only the plays it wins in the mpv
 * claim channel. `playbackAttached` serves older MCPs, which defer to an attached owner.
 */
export function handleHealth(req: IncomingMessage, res: ServerResponse, config: Config): void {
  // The version is a fingerprint, so a LAN bind hides the route from remote peers. The port-as-lock
  // probe connects through 127.0.0.1, so this gate never blocks it.
  if (isLanReachable(config.webui.host) && !isLocalRequest(req)) {
    writeError(res, 404, 'Not found');
    return;
  }
  writeJson(res, 200, {
    app: HEALTH_APP_ID,
    version: getPackageVersion(),
    playbackAttached: playbackEngine.isRunning(),
    scrobbleClaims: true,
  });
}
