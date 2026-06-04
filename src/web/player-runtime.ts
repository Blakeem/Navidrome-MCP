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
 * Mutable runtime state for the standalone player process, plus the pure
 * decision helpers that drive UI affordances. Split out so the lifecycle logic
 * is unit-testable without a running HTTP server / mpv.
 *
 * The persist flag governs whether a player spawned by the MCP server keeps
 * running after the MCP server exits (spec: webui.persistAfterMcpExit). It's
 * initialized from config at startup and can be toggled live from the player's
 * loopback-only settings modal.
 */

let persist = false;

/** Seed the flag from config at process startup. */
export function initPersist(value: boolean): void {
  persist = value;
}

/** Toggle the flag at runtime (the player's settings modal). */
export function setPersist(value: boolean): void {
  persist = value;
}

export function getPersist(): boolean {
  return persist;
}

/**
 * Whether this process still has a live IPC parent (the MCP server that spawned
 * it). `process.connected` is true only when spawned with an `ipc` channel AND
 * the parent is still alive; it flips to false on `disconnect`. A standalone
 * `navidrome-web` (no IPC channel) is always false → treated as independent.
 */
export function hasLiveParent(): boolean {
  return process.connected;
}

export interface PlayerFlags {
  /** Settings modal is allowed (loopback callers only). */
  canEditSettings: boolean;
  /** Power button is allowed: local AND the server won't be auto-closed by MCP. */
  canPowerOff: boolean;
}

/**
 * Pure UI-affordance decision (spec lifecycle table):
 * - settings are local-only;
 * - power is offered only to a local caller AND only when the server is NOT
 *   going to be torn down by an MCP exit — i.e. it has no live parent
 *   (standalone, or MCP already gone) OR persistence is on.
 */
export function computePlayerFlags(input: {
  isLocal: boolean;
  hasLiveParent: boolean;
  persist: boolean;
}): PlayerFlags {
  return {
    canEditSettings: input.isLocal,
    canPowerOff: input.isLocal && (!input.hasLiveParent || input.persist),
  };
}
