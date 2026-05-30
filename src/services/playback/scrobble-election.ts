/**
 * Navidrome MCP Server - Scrobbler single-submitter election
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

import type { Config } from '../../config.js';

/**
 * Whether the MCP process should be the active scrobble submitter
 * (standalone-web spec §6.4).
 *
 * Exactly one process scrobbles each mpv play. The rule, evaluated identically
 * everywhere: *I submit iff I am the web port owner, OR no web server is
 * configured and I am MCP.* Since `webui.enabled` is the single source of "is
 * there a web server," MCP submits only in MCP-only mode — when a web server is
 * enabled, the spawned `navidrome-web` port owner is the submitter instead.
 *
 * The election is config-static (no live handoff): MCP never scrobbles while
 * `webui.enabled`, so there is no double-submit race. The web owner primes
 * from current mpv state on attach without re-scrobbling the in-flight track,
 * so a track already counted isn't double-submitted when the owner comes up.
 */
export function shouldMcpSubmit(config: Config): boolean {
  return config.features.playback && !config.webui.enabled;
}
