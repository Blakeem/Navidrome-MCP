/**
 * Navidrome MCP Server - Web player startup banner
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Config, StartupFailure } from '../config.js';
import { redact } from '../utils/logger.js';
import { isLanReachable, listLanInterfaces, loopbackUrl } from '../webui/network.js';
import { adminPageUrl } from '../webui/page-paths.js';
import { isTlsEnabled } from '../webui/tls.js';

/** Without it the host user cannot tell the browser's certificate warning from an attack. */
export const TLS_LOCAL_ADDRESS_WARNING =
  'When the certificate names only the public host, the browser warns that the connection is not private ' +
  'on the 127.0.0.1 and LAN addresses. This warning is expected for this player.';

export function buildBannerLines(webui: Config['webui']): string[] {
  const secure = isTlsEnabled(webui.tls);
  const lines = [`navidrome-web listening on ${adminPageUrl(loopbackUrl(webui.port, secure))}`];
  if (isLanReachable(webui.host)) {
    for (const iface of listLanInterfaces(webui.port, secure)) {
      lines.push(`  LAN: ${adminPageUrl(iface.url)} (${iface.iface})`);
    }
  }
  if (secure) lines.push(TLS_LOCAL_ADDRESS_WARNING);
  return lines;
}

/** An absent failure is a first run. A reason may hold a credential-bearing URL, and stdout reaches a host's log. */
export function buildSetupHeadline(failure: StartupFailure | undefined): string {
  if (failure === undefined) return 'navidrome-web is not configured yet.';
  return `navidrome-web could not start with the current configuration: ${redact(failure.reason) as string}`;
}
