/**
 * Navidrome MCP Server - Web UI Health Route
 * Copyright (C) 2025
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import { playbackEngine } from '../../services/playback/playback-engine.js';
import { getPackageVersion } from '../../utils/version.js';
import { writeError, writeJson } from '../http-helpers.js';
import { isLocalRequest } from '../loopback.js';
import { isLanReachable } from '../network.js';

/**
 * The signature `acquireOrAttach` (src/web/acquire.ts) probes to distinguish
 * *our* server from an unrelated process squatting the configured port, so a
 * foreign signature ⇒ port conflict.
 */
export const HEALTH_APP_ID = 'navidrome-mcp-web';

/**
 * GET /healthz is a small JSON signature used for port-as-lock coexistence.
 * `scrobbleClaims` says this owner submits only the plays it wins in the mpv claim
 * channel, so an MCP tracker claims alongside it. `playbackAttached` serves MCPs
 * older than that flag, which defer to an attached owner.
 *
 * When the resolved bind host is LAN-reachable, /healthz would leak a version
 * fingerprint, so it is gated to loopback peers (returning 404 to hide its
 * existence). The acquire probe always connects via 127.0.0.1, so this gate
 * never interferes with coexistence.
 */
export function handleHealth(req: IncomingMessage, res: ServerResponse, config: Config): void {
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
