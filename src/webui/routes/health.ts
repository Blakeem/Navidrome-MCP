/**
 * Navidrome MCP Server - Web UI Health Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import { getPackageVersion } from '../../utils/version.js';
import { writeError, writeJson } from '../http-helpers.js';
import { isLocalRequest } from '../loopback.js';
import { isLanReachable } from '../network.js';

/** The port-as-lock probe tells a Jukebox Remote owner from a foreign process by this value. The id keeps its old name, so a new MCP server still recognizes an old running player. */
export const HEALTH_APP_ID = 'navidrome-mcp-web';

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
    // A Save does not rebind a running player, so open_jukebox_remote reads the bind from here, not settings.json.
    lan: isLanReachable(config.webui.host),
  });
}
