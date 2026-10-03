/**
 * Navidrome MCP Server - Radio Browser Per-Session Rate Limit
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

// Per-process dedup for Radio Browser vote and click. Radio Browser rejects repeats per IP per day,
// and an LLM looping over stations would pile up rejected requests that risk a ban on the shared User-Agent.

const votedUuids = new Set<string>();
const clickedUuids = new Set<string>();

export function hasRecentlyVoted(uuid: string): boolean {
  return votedUuids.has(uuid);
}

export function markVoted(uuid: string): void {
  votedUuids.add(uuid);
}

export function hasRecentlyClicked(uuid: string): boolean {
  return clickedUuids.has(uuid);
}

export function markClicked(uuid: string): void {
  clickedUuids.add(uuid);
}

/** Test-only reset. Production sets persist for the process lifetime. */
export function resetRadioBrowserRateLimit(): void {
  votedUuids.clear();
  clickedUuids.clear();
}
