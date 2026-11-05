/**
 * Navidrome MCP Server - Web UI Network Info Route
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import { isLanReachable, listLanInterfaces, loopbackUrl } from '../network.js';
import { writeJson } from '../http-helpers.js';
import { adminPageUrl } from '../page-paths.js';
import { isTlsEnabled } from '../tls.js';

/**
 * The bind and expose settings let the panel explain why only localhost is listed. The localhost
 * URL is always included, so the user has a working entry when no LAN interface is found.
 */
export function handleNetworkInfo(res: ServerResponse, config: Config): void {
  const port = config.webui.port;
  const secure = isTlsEnabled(config.webui.tls);
  const localhost = adminPageUrl(loopbackUrl(port, secure));
  const lanReachable = isLanReachable(config.webui.host);
  const lan = lanReachable ? listLanInterfaces(port, secure).map((iface) => ({ ...iface, url: adminPageUrl(iface.url) })) : [];

  writeJson(res, 200, {
    host: config.webui.host,
    port,
    expose: config.webui.expose,
    lanReachable,
    localhostUrl: localhost,
    interfaces: lan,
  });
}
