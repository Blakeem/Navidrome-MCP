/**
 * Navidrome MCP Server - Web UI Network Info Route
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

import type { ServerResponse } from 'node:http';
import type { Config } from '../../config.js';
import { listLanInterfaces } from '../network.js';
import { writeJson } from '../http-helpers.js';

/**
 * GET /api/network-info — Reports the addresses the user can use to reach
 * this web UI, plus the current bind/expose configuration so the panel can
 * explain WHY only localhost is listed when expose is off.
 *
 * Always-included localhost URL gives the user a known-working entry even
 * when no LAN interfaces are discovered (single-NIC laptop on cellular,
 * loopback-only container, etc.).
 */
export function handleNetworkInfo(res: ServerResponse, config: Config): void {
  const port = config.webui.port;
  const localhost = `http://127.0.0.1:${port}`;
  const lan = config.webui.expose || config.webui.host === '0.0.0.0'
    ? listLanInterfaces(port)
    : [];

  writeJson(res, 200, {
    host: config.webui.host,
    port,
    expose: config.webui.expose,
    localhostUrl: localhost,
    interfaces: lan,
  });
}
