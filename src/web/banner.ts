/**
 * Navidrome MCP Server - Jukebox Remote startup banner
 * Copyright (C) 2025
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { STOP_HINT } from '../cli/texts.js';
import { LIVE_APPLY_WHEN, LIVE_AUTH_FIELDS } from '../config-app/save-message.js';
import type { Config, StartupFailure } from '../config.js';
import { redact } from '../utils/logger.js';
import { isLanReachable, listLanInterfaces, loopbackUrl } from '../webui/network.js';
import { adminPageUrl } from '../webui/page-paths.js';
import { isTlsEnabled } from '../webui/tls.js';

/** Without it the host user cannot tell the browser's certificate warning from an attack. */
export const TLS_LOCAL_ADDRESS_WARNING =
  'When the certificate names only the public host, the browser warns that the connection is not private ' +
  'on the 127.0.0.1 and LAN addresses. This warning is expected for this player.';

/** A re-run attaches to the running player and never reloads its settings, so the line tells the user how to apply a change. */
const ATTACH_SETTINGS_NOTE =
  'Settings page changes saved after it started apply once you click Shut down player in the gear menu and start it again. ' +
  `A new admin password, ${LIVE_AUTH_FIELDS} apply without that step when ${LIVE_APPLY_WHEN}.`;

/** A foreground run is one a person started, so only it gets the line that says how to stop. */
export function buildBannerLines(webui: Config['webui'], foreground: boolean): string[] {
  const secure = isTlsEnabled(webui.tls);
  const lines = [`Jukebox Remote listening on ${adminPageUrl(loopbackUrl(webui.port, secure))}`];
  if (isLanReachable(webui.host)) {
    for (const iface of listLanInterfaces(webui.port, secure)) {
      lines.push(`  LAN: ${adminPageUrl(iface.url)} (${iface.iface})`);
    }
  }
  if (secure) lines.push(TLS_LOCAL_ADDRESS_WARNING);
  if (foreground) lines.push(STOP_HINT);
  return lines;
}

/** The first line names the running player and the rest tell the user what a second launch does not do. */
export function buildAttachLines(adminUrl: string, secure: boolean): string[] {
  const lines = [`Jukebox Remote already running at ${adminUrl}.`, ATTACH_SETTINGS_NOTE];
  if (secure) lines.push(TLS_LOCAL_ADDRESS_WARNING);
  return lines;
}

/** An absent failure is a first run. A reason may hold a credential-bearing URL, and stdout reaches a host's log. */
export function buildSetupHeadline(failure: StartupFailure | undefined): string {
  if (failure === undefined) return 'Jukebox Remote is not configured yet.';
  return `Jukebox Remote could not start with the current configuration: ${redact(failure.reason) as string}`;
}
