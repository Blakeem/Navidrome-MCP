/**
 * Navidrome MCP Server - Loopback requests to the web player
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { request as httpRequest, type ClientRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

/**
 * The player's certificate names its public host, never 127.0.0.1, so an HTTPS call skips the
 * certificate check. The healthz `app` id identifies the player instead.
 */
export function loopbackRequest(
  secure: boolean,
  options: RequestOptions,
  onResponse: (res: IncomingMessage) => void,
): ClientRequest {
  if (!secure) return httpRequest(options, onResponse);
  return httpsRequest({ ...options, rejectUnauthorized: false }, onResponse);
}
