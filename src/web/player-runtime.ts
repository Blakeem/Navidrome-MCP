/**
 * Navidrome MCP Server - Player runtime state
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

/**
 * Mutable runtime state for the standalone player process. Split out so the
 * lifecycle state is unit-testable without a running HTTP server or mpv.
 *
 * The persist flag governs whether a player spawned by the MCP server keeps
 * running after the MCP server exits (webui.persistAfterMcpExit). It's
 * initialized from config at startup and can be toggled live from the player's
 * loopback-only settings modal. The theme follows the same seed-then-toggle path,
 * and null leaves each device on its own light or dark setting.
 */

import type { WebuiTheme } from '../constants/defaults.js';

let persist = false;
let theme: WebuiTheme | null = null;

/** Seeds the flag from config at startup and toggles it at runtime. */
export function setPersist(value: boolean): void {
  persist = value;
}

export function getPersist(): boolean {
  return persist;
}

export function setTheme(value: WebuiTheme | null): void {
  theme = value;
}

export function getTheme(): WebuiTheme | null {
  return theme;
}

/** An MCP-launched player stops once no MCP uses it: its spawner is gone and no lease is open. */
export function shouldStopForMcpExit(state: {
  launchedByMcp: boolean;
  parentConnected: boolean;
  openLeases: number;
  persist: boolean;
}): boolean {
  return state.launchedByMcp && !state.parentConnected && state.openLeases === 0 && !state.persist;
}
